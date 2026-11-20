// 运营评测状态（runtime_state）dao。
async function saveLatestEvaluation(db, payload) {
  await db.query(
    `INSERT INTO runtime_state (namespace,state_key,payload,expires_at) VALUES ('operations','evaluation:latest',?,?)
     ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`,
    [JSON.stringify(payload), payload.expiresAt]);
}

module.exports = { saveLatestEvaluation };
