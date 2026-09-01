const {
  createApp,
  startServer
} = require(
  "./server"
);

if (
  require.main ===
  module
) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
