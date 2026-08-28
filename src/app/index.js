const {
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
  startServer
};
