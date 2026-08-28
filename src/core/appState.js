const state = {
  startedAt:
    new Date().toISOString(),

  environment:
    process.env.NODE_ENV ||
    "development",

  liveMode: false,

  services: {
    database: false,
    ai: false,
    discovery: false,
    crm: false,
    sales: false,
    analytics: false
  }
};

function setServiceStatus(
  service,
  status
) {
  if (
    Object.prototype.hasOwnProperty.call(
      state.services,
      service
    )
  ) {
    state.services[service] =
      Boolean(status);
  }
}

function getAppState() {
  return {
    ...state,

    services: {
      ...state.services
    }
  };
}

module.exports = {
  state,
  setServiceStatus,
  getAppState
};
