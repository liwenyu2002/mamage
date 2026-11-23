import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { literalString, parseServerSource, projectRoot, propertyName, serverRoot, walk } from './lib/server-source.mjs';

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const nameOf = node => node?.type === 'Identifier' ? node.name : null;
const combine = (base, route) => (base + (route === '/' ? '' : route)) || '/';
const isApi = url => url === '/api' || url.startsWith('/api/');
const within = (route, prefix) => route === prefix || route.startsWith(prefix + '/') || prefix === '/';

function directRequire(node, file) {
  if (node?.type !== 'CallExpression' || nameOf(node.callee) !== 'require') return null;
  const request = literalString(node.arguments[0]);
  if (!request?.startsWith('.')) return null;
  const target = path.resolve(path.dirname(file), request);
  return { file: path.extname(target) ? target : target + '.js' };
}

function loadSource(file) {
  const ast = parseServerSource(fs.readFileSync(file, 'utf8'));
  const imports = new Map();
  const declarations = new Map();
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration') declarations.set(node.id.name, node);
    if (node.type !== 'VariableDeclarator') return;
    const source = directRequire(node.init, file);
    if (!source) return;
    if (node.id.type === 'Identifier') imports.set(node.id.name, source);
    if (node.id.type === 'ObjectPattern') {
      for (const property of node.id.properties) {
        if (property.type === 'Property' && nameOf(property.value)) {
          imports.set(property.value.name, { ...source, imported: nameOf(property.key) || literalString(property.key) });
        }
      }
    }
  });
  const resolve = (node) => {
    if (node?.type === 'MemberExpression') {
      const source = directRequire(node.object, file) || imports.get(nameOf(node.object));
      return source && { ...source, imported: propertyName(node) };
    }
    return directRequire(node, file) || imports.get(nameOf(node));
  };
  return { file, ast, declarations, resolve };
}

function guardLabel(node) {
  const name = nameOf(node?.callee || node);
  const permission = node?.type === 'CallExpression' && literalString(node.arguments[0]);
  if (name === 'requirePermission' && permission) return `权限 ${permission}`;
  if (name === 'authMiddleware' || name === 'requireAuth') return '登录';
  if (name === 'requireAdmin') return '管理员';
  if (name === 'requireSuperAdmin') return '超级管理员';
  return null;
}

function resolveString(node, bindings) {
  if (nameOf(node)) return bindings.get(node.name) ?? null;
  if (node?.type === 'TemplateLiteral') {
    const parts = node.expressions.map(expr => resolveString(expr, bindings));
    return parts.includes(null) ? null : node.quasis.map((part, i) => part.value.cooked + (parts[i] ?? '')).join('');
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = resolveString(node.left, bindings), right = resolveString(node.right, bindings);
    return left === null || right === null ? null : left + right;
  }
  return literalString(node);
}

function routePaths(call, parents) {
  const name = call.arguments[0];
  const plain = resolveString(name, new Map());
  if (plain !== null) return [plain];
  let loop = parents.get(call);
  while (loop && loop.type !== 'ForOfStatement') loop = parents.get(loop);
  if (loop?.left.type !== 'VariableDeclaration' || loop.right.type !== 'ArrayExpression') return [];
  const pattern = loop.left.declarations[0].id;
  return loop.right.elements.map((item) => {
    const bindings = new Map();
    if (nameOf(pattern)) bindings.set(pattern.name, literalString(item));
    else if (pattern.type === 'ArrayPattern' && item?.type === 'ArrayExpression') {
      pattern.elements.forEach((id, i) => { if (nameOf(id)) bindings.set(id.name, literalString(item.elements[i])); });
    }
    return resolveString(name, bindings);
  });
}

export function inventory(root = serverRoot) {
  const rows = [];
  const keys = new Set();
  const loaded = new Map();
  const load = (file) => {
    if (!loaded.has(file)) loaded.set(file, loadSource(file));
    return loaded.get(file);
  };
  const routes = path.join(root, 'routes') + path.sep;

  function scan(source, body, receiver, base, inherited = [], ancestors = []) {
    const visits = [];
    const parents = new WeakMap();
    walk(body, (node, parent) => {
      if (node.type === 'CallExpression') visits.push(node);
      if (parent) parents.set(node, parent);
    });
    const guards = [...inherited];
    for (const call of visits) {
      const { callee, arguments: args } = call;
      const verb = nameOf(callee.object) === receiver ? propertyName(callee) : null;
      const routePath = literalString(args[0]);
      if (verb === 'use') {
        const prefix = combine(base, routePath || '');
        const middleware = routePath === null ? args : args.slice(1);
        const visible = [...guards.filter(guard => within(prefix, guard.prefix))];
        for (const item of middleware) {
          const label = guardLabel(item);
          if (label) {
            const guard = { prefix, label };
            guards.push(guard);
            visible.push(guard);
          }
          const linked = source.resolve(item);
          if (linked?.file.startsWith(routes) && isApi(prefix)) {
            follow(linked, prefix, visible, ancestors);
          }
        }
        continue;
      }
      if (methods.has(verb)) {
        const paths = routePaths(call, parents);
        if (!paths.length || paths.some(item => item === null)) {
          throw Error(`Cannot document dynamic route in ${source.file}:${call.loc.start.line}`);
        }
        const method = verb.toUpperCase();
        for (const item of paths) {
          const endpoint = combine(base, item);
          if (!isApi(endpoint)) continue;
          const key = method + ' ' + endpoint;
          if (keys.has(key)) throw Error(`Duplicate documented route: ${key} (${source.file}:${call.loc.start.line})`);
          keys.add(key);
          const labels = guards.filter(guard => within(endpoint, guard.prefix)).map(guard => guard.label);
          labels.push(...args.slice(1).map(guardLabel).filter(Boolean));
          rows.push({ method, endpoint, guards: [...new Set(labels)], file: path.relative(root, source.file) });
        }
        continue;
      }
      if (nameOf(args[0]) === receiver) {
        const linked = source.resolve(callee);
        if (linked?.imported && /^(register|mount)[A-Z]/.test(linked.imported)) follow(linked, base, guards, ancestors);
      }
    }
  }

  function follow(linked, base, inherited, ancestors) {
    const identity = linked.file + ':' + (linked.imported || '');
    if (ancestors.includes(identity)) throw Error(`Circular route registration: ${identity}`);
    const source = load(linked.file);
    const declaration = linked.imported && source.declarations.get(linked.imported);
    if (linked.imported && !declaration) throw Error(`Missing route registration declaration: ${identity}`);
    const receiver = declaration ? nameOf(declaration.params[0]) : 'router';
    if (!receiver) throw Error(`Expected a router argument in ${identity}`);
    scan(source, declaration?.body || source.ast, receiver, base, inherited, [...ancestors, identity]);
  }

  const app = load(path.join(root, 'app.js'));
  scan(app, app.ast, 'app', '');
  return rows.sort((a, b) => a.endpoint.localeCompare(b.endpoint, 'en') || a.method.localeCompare(b.method, 'en'));
}

function main() {
  const rows = inventory();
  const output = [
    '# API 路由与可见鉴权（自动生成）',
    '',
    '> 根据 app.js 的挂载及其引用的路由注册函数生成；不猜测文件名对应的路径。',
    '> 仅列出显式 HTTP 方法注册和可静态识别的鉴权。未标出守卫不代表匿名可访问；路由内部、动态中间件及对象权限靠行为测试验证。',
    '',
    `共 ${rows.length} 条显式路由。`,
    '',
    '| 方法 | 路径 | 可识别的守卫 | 源文件 |',
    '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.method} | \`${row.endpoint}\` | ${row.guards.join('、') || '未由静态检查确认'} | \`apps/server/${row.file}\` |`),
    '',
  ].join('\n');
  const target = path.join(projectRoot, 'docs/api-auth-matrix.md');
  if (process.argv.includes('--write')) fs.writeFileSync(target, output);
  else if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) {
      throw Error('api-auth-matrix.md 已过期，请运行 node scripts/gen-auth-matrix.mjs --write');
    }
    console.log(`API 路由清单一致（${rows.length} 条）`);
  } else process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
