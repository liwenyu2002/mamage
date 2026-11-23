import { createRequire } from 'node:module';
import path from 'node:path';

export const projectRoot = path.resolve(import.meta.dirname, '../..');
export const serverRoot = path.join(projectRoot, 'apps/server');
const { parse } = createRequire(path.join(serverRoot, 'package.json'))('espree');

export const parseServerSource = (text) => parse(text, { ecmaVersion: 'latest', sourceType: 'commonjs', loc: true });

export function walk(node, visit, parent = null) {
  if (!node?.type) return;
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else if (value?.type) walk(value, visit, node);
  }
}

export function propertyName(member) {
  if (member?.type !== 'MemberExpression') return null;
  return member.computed ? literalString(member.property) : member.property.name;
}

export function literalString(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}
