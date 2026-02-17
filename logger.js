function log(type, message, data = {}) {
  const time = new Date().toISOString();
  console.log(`[${time}] [${type}] ${message}`, data);
}

module.exports = { log };
