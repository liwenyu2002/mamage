const bounded = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? Math.min(max, Math.floor(parsed)) : fallback;
};

function createRuntimeLifecycle({ checkReady, stopWork = async () => {}, closeDependencies = async () => {},
  readyTimeoutMs = 2000, shutdownTimeoutMs = 55000, exit = code => process.exit(code), logger = console } = {}) {
  let server;
  let started = false;
  let draining = false;
  let readinessCheck;
  let shutdownPromise;
  let exitCode = 0;

  async function ready() {
    if (!started || draining) return false;
    if (!readinessCheck) {
      const task = Promise.resolve().then(checkReady);
      readinessCheck = task;
      task.then(() => { if (readinessCheck === task) readinessCheck = null; },
        () => { if (readinessCheck === task) readinessCheck = null; });
    }
    let timeout;
    try {
      await Promise.race([readinessCheck, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('READINESS_TIMEOUT')), readyTimeoutMs);
      })]);
      return started && !draining;
    } catch { return false; }
    finally { clearTimeout(timeout); }
  }

  function shutdown(reason = 'shutdown', code = 0) {
    exitCode = Math.max(exitCode, code);
    if (shutdownPromise) return shutdownPromise;
    draining = true;
    logger.info?.(`[runtime] draining: ${reason}`);
    shutdownPromise = (async () => {
      let finished = false;
      const force = setTimeout(() => {
        if (finished) return;
        finished = true;
        server?.closeAllConnections?.();
        logger.error?.('[runtime] shutdown deadline exceeded');
        exit(1);
      }, shutdownTimeoutMs);
      try {
        const closeServer = new Promise((resolve, reject) => {
          if (!server?.listening) return resolve();
          server.close(error => error ? reject(error) : resolve());
          server.closeIdleConnections?.();
        });
        // Stop accepting work while existing requests and durable jobs finish together.
        await Promise.all([Promise.resolve().then(stopWork), closeServer]);
        await closeDependencies();
      } catch (error) {
        exitCode = 1;
        logger.error?.('[runtime] shutdown failed:', error?.code || error?.name || 'Error');
      } finally {
        if (!finished) {
          finished = true;
          clearTimeout(force);
          exit(exitCode);
        }
      }
    })();
    return shutdownPromise;
  }

  function installSignals(target = process) {
    const handlers = {
      SIGTERM: () => void shutdown('SIGTERM'),
      SIGINT: () => void shutdown('SIGINT'),
      uncaughtException: error => { logger.error?.('UNCAUGHT EXCEPTION:', error?.stack || error); void shutdown('uncaughtException', 1); },
      unhandledRejection: error => { logger.error?.('UNHANDLED REJECTION:', error?.stack || error); void shutdown('unhandledRejection', 1); },
    };
    for (const [event, handler] of Object.entries(handlers)) target.on(event, handler);
    return () => { for (const [event, handler] of Object.entries(handlers)) target.removeListener(event, handler); };
  }

  return { ready, shutdown, installSignals, isDraining: () => draining,
    markStarted: listeningServer => { server = listeningServer; started = true; } };
}

async function waitForIdle(isIdle) {
  while (!isIdle()) await new Promise(resolve => setTimeout(resolve, 25));
}

module.exports = { createRuntimeLifecycle, bounded, waitForIdle };
