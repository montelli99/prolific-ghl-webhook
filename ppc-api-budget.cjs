"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// These are our background ceilings, not the provider's advertised capacity.
const policies = {
  justcall: { gap: 3000, burst: 60_000, long: 3_600_000 },
  ghl: { gap: 500, burst: 10_000, long: 86_400_000 },
};

function number(value) {
  return value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

function futureEpoch(value, now) {
  const n = number(value);
  const at = n === null ? Date.parse(value || "") : n > 1e12 ? n : n > 1e9 ? n * 1000 : 0;
  return at > now ? at : 0;
}

function feedback(provider, headers = {}, status, now = Date.now()) {
  const p = policies[provider];
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const jc = provider === "justcall";
  const burstLeft = number(h[jc ? "x-rate-limit-burst-remaining" : "x-ratelimit-remaining"]);
  const longLeft = number(h[jc ? "x-rate-limit-remaining" : "x-ratelimit-daily-remaining"]);
  const burstWindow = jc
    ? p.burst
    : Math.max(p.burst, number(h["x-ratelimit-interval-milliseconds"]) || 0);
  const burstReset =
    futureEpoch(h[jc ? "x-rate-limit-burst-reset" : "x-ratelimit-reset"], now) || now + burstWindow;
  const longReset =
    futureEpoch(h[jc ? "x-rate-limit-reset" : "x-ratelimit-daily-reset"], now) || now + p.long;
  let blockedUntil = 0;
  let gap = p.gap;
  // Use at most half of remaining capacity, spread across the window. This
  // leaves room for traffic from integrations outside this coordinator.
  for (const [left, reset] of [
    [burstLeft, burstReset],
    [longLeft, longReset],
  ]) {
    if (left === null) continue;
    if (left <= 0) blockedUntil = Math.max(blockedUntil, reset + 1000);
    else gap = Math.max(gap, Math.ceil((reset - now) / Math.max(1, left / 2)));
  }
  if (status === 429) {
    const retry = h["retry-after"];
    const seconds = number(retry);
    const retryAt =
      seconds !== null && seconds >= 0 ? now + seconds * 1000 : futureEpoch(retry, now);
    blockedUntil = Math.max(blockedUntil, retryAt, now + burstWindow + 1000);
  }
  return { gap, blockedUntil, observedAt: now, burstLeft, longLeft };
}

function createBudget({
  directory,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  fs.mkdirSync(directory, { recursive: true });
  function file(provider, scope) {
    return path.join(
      directory,
      `${provider}-${crypto.createHash("sha256").update(scope).digest("hex")}.json`,
    );
  }
  async function transaction(filename, fn) {
    const lock = `${filename}.lock`;
    for (let attempt = 0; attempt < 100; attempt++) {
      let fd;
      try {
        fd = fs.openSync(lock, "wx");
      } catch (error) {
        // Windows may report a sharing violation while another process is
        // closing/deleting the lock. Retry without changing its permissions.
        if (error.code === "EPERM" || error.code === "EACCES") {
          if (attempt === 99) throw error;
          await sleep(20);
          continue;
        }
        if (error.code !== "EEXIST") throw error;
        // Never steal a live process's lock. A crash can leave a dead PID.
        try {
          const pid = Number(fs.readFileSync(lock, "utf8"));
          if (pid > 0) {
            try {
              process.kill(pid, 0);
            } catch (probe) {
              if (probe.code === "ESRCH") fs.unlinkSync(lock);
            }
          }
        } catch {}
        await sleep(20);
        continue;
      }
      try {
        fs.writeFileSync(fd, String(process.pid));
        let state = {};
        try {
          state = JSON.parse(fs.readFileSync(filename, "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const result = fn(state);
        const temp = `${filename}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(state));
        fs.renameSync(temp, filename);
        return result;
      } finally {
        fs.closeSync(fd);
        fs.unlinkSync(lock);
      }
    }
    throw new Error("API_BUDGET_LOCK_BUSY");
  }
  async function request(provider, scope, send) {
    const filename = file(provider, scope);
    for (;;) {
      const reservation = await transaction(filename, (state) => {
        const time = now();
        const ready = Math.max(state.nextAt || 0, state.blockedUntil || 0);
        if (ready > time) return { wait: ready - time, at: ready };
        // Persist the reservation before any network operation.
        state.nextAt = time + Math.max(policies[provider].gap, state.gap || 0);
        return { wait: 0 };
      });
      if (reservation.wait > 60_000)
        return {
          ok: false,
          status: 429,
          data: { error: "LOCAL_API_BUDGET_DEFERRED" },
          retry_at: new Date(reservation.at).toISOString(),
          local_throttle: true,
        };
      if (!reservation.wait) break;
      await sleep(reservation.wait);
    }
    const response = await send();
    const observed = feedback(provider, response.headers, response.status, now());
    await transaction(filename, (state) => {
      // An older in-flight success must not clear another process's cooldown.
      state.blockedUntil = Math.max(state.blockedUntil || 0, observed.blockedUntil);
      state.gap = observed.gap;
      state.nextAt = Math.max(state.nextAt || 0, now() + observed.gap);
      state.last = { status: response.status, ...observed };
    });
    if (response.status === 429) response.retry_at = new Date(observed.blockedUntil).toISOString();
    return response;
  }
  return { request };
}

module.exports = { feedback, createBudget };
