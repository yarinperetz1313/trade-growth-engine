import OpportunityCommandCenter from "./components/OpportunityCommandCenter.jsx";
import React, {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  createRoot
} from "react-dom/client";

import "./styles.css";
import "./main.css";
import SystemStatus from "./components/SystemStatus";
import usePipelineData from "./hooks/usePipelineData";

import {
  getProspects,
  createOpportunityFromProspect,
  getOpportunities,
  updateOpportunityStage,
  getOpportunityActivities,
  getOpportunityTasks,
  createTask,
  updateTask
} from "./lib/api";

const prospects = [
  {
    id: 1,
    name: "Apex Electrical",
    location: "Melbourne",
    service: "Commercial Electrical",
    score: 94,
    status: "HOT",
    value: 18500
  },
  {
    id: 2,
    name: "Metro Climate Solutions",
    location: "Richmond",
    service: "HVAC",
    score: 88,
    status: "HOT",
    value: 12400
  },
  {
    id: 3,
    name: "Brightline Plumbing",
    location: "Oakleigh",
    service: "Commercial Plumbing",
    score: 81,
    status: "WARM",
    value: 9200
  },
  {
    id: 4,
    name: "Southside Mechanical",
    location: "Clayton",
    service: "Mechanical Services",
    score: 73,
    status: "WARM",
    value: 7100
  },
  {
    id: 5,
    name: "Urban Fire Systems",
    location: "Dandenong",
    service: "Fire Protection",
    score: 64,
    status: "WATCH",
    value: 4800
  }
];

const pipeline = [
  {
    name: "Apex Electrical",
    stage: "Qualified",
    value: 18500
  },
  {
    name: "Metro Climate Solutions",
    stage: "Contacted",
    value: 12400
  },
  {
    name: "Brightline Plumbing",
    stage: "Meeting",
    value: 9200
  },
  {
    name: "Southside Mechanical",
    stage: "New",
    value: 7100
  }
];

const nav = [
  ["dashboard", "Dashboard"],
  ["prospects", "Prospects"],
  ["opportunities", "Opportunities"],
  ["pipeline", "Pipeline"],
  ["campaigns", "Campaigns"],
  ["intelligence", "Intelligence"],
  ["economics", "Economics"],
  ["experiments", "Experiments"],
  ["analytics", "Analytics"],
  ["reports", "Reports"],
  ["settings", "Settings"]
];

function money(
  value
) {
  return new Intl.NumberFormat(
    "en-AU",
    {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0
    }
  ).format(value);
}

function pageFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");

  if (hash.startsWith("opportunities/")) {
    return "opportunities";
  }

  return hash || "dashboard";
}

function App() {
  const [
    page,
    setPage
  ] = useState(
    pageFromHash
  );

  const [
    search,
    setSearch
  ] = useState("");

  useEffect(() => {
    const syncPageFromHash = () => {
      setPage(pageFromHash());
    };

    window.addEventListener(
      "hashchange",
      syncPageFromHash
    );

    return () => {
      window.removeEventListener(
        "hashchange",
        syncPageFromHash
      );
    };
  }, []);

  const navigatePage = id => {
    window.location.hash = id;
    setPage(id);
  };

  const filteredProspects =
    useMemo(() => {
      const term =
        search
          .toLowerCase()
          .trim();

      if (!term) {
        return prospects;
      }

      return prospects.filter(
        item =>
          item.name
            .toLowerCase()
            .includes(term) ||
          item.service
            .toLowerCase()
            .includes(term) ||
          item.location
            .toLowerCase()
            .includes(term)
      );
    }, [search]);

  return (
    <div className="app">

      <aside className="sidebar">

        <div className="brand">
          <div className="brand-mark">
            TG
          </div>

          <div>
            <div className="brand-name">
              Trade Growth
            </div>

            <div className="brand-sub">
              Intelligence Engine
            </div>
          </div>
        </div>

        <div className="nav-section">
          CORE
        </div>

        {nav.slice(0, 5).map(
          ([id, label]) => (
            <button
              key={id}
              className={
                page === id
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                navigatePage(id)
              }
            >
              <span className="nav-dot" />
              {label}
            </button>
          )
        )}

        <div className="nav-section">
          INTELLIGENCE
        </div>

        {nav.slice(5, 9).map(
          ([id, label]) => (
            <button
              key={id}
              className={
                page === id
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                navigatePage(id)
              }
            >
              <span className="nav-dot" />
              {label}
            </button>
          )
        )}

        <div className="nav-section">
          SYSTEM
        </div>

        <button
          className={
            page === "reports"
              ? "nav-item active"
              : "nav-item"
          }
          onClick={() =>
            navigatePage("reports")
          }
        >
          <span className="nav-dot" />
          Reports
        </button>

        <button
          className={
            page === "settings"
              ? "nav-item active"
              : "nav-item"
          }
          onClick={() =>
            navigatePage("settings")
          }
        >
          <span className="nav-dot" />
          Settings
        </button>

        <div className="sidebar-bottom">
          <SystemStatus />
        </div>

      </aside>

      <main className="main" data-testid="app-main">

        <header className="topbar">

          <div>
            <div className="eyebrow">
              TRADE GROWTH ENGINE
            </div>

            <h1>
              {page === "dashboard"
                ? "Command Center"
                : nav.find(
                    item =>
                      item[0] === page
                  )?.[1] || page}
            </h1>
          </div>

          <div className="top-actions">

            <div className="search">
              <span>⌕</span>

              <input
                value={search}
                onChange={e =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Search prospects..."
              />
            </div>

            <button className="avatar">
              Y
            </button>

          </div>

        </header>

        {page === "dashboard" && (
          <Dashboard />
        )}

        {page === "prospects" && (
          <Prospects
            data={
              filteredProspects
            }
          />
        )}

        {page === "pipeline" && (
          <Pipeline />
        )}

        {page === "opportunities" && (
          <Opportunities />
        )}

        {page === "campaigns" && (
          <Campaigns />
        )}

        {page === "intelligence" && (
          <Intelligence />
        )}

        {page === "economics" && (
          <Economics />
        )}

        {page === "experiments" && (
          <Experiments />
        )}

        {page === "analytics" && (
          <Analytics />
        )}

        {page === "reports" && (
          <Reports />
        )}

        {page === "settings" && (
          <Settings />
        )}

      </main>

    </div>
  );
}

function Dashboard() {
  const {
    metrics,
    opportunities,
    loading,
    error,
    refresh
  } = usePipelineData();

  const activeOpportunities =
    opportunities.filter(
      item =>
        item.stage !== "WON" &&
        item.stage !== "LOST"
    );

  const qualifiedLeads =
    opportunities.filter(
      item =>
        Number(
          item.qualification_score || 0
        ) >= 70
    ).length;

  const averageScore =
    activeOpportunities.length
      ? (
          activeOpportunities.reduce(
            (sum, item) =>
              sum +
              Number(
                item.qualification_score || 0
              ),
            0
          ) /
          activeOpportunities.length
        ).toFixed(1)
      : "0.0";

  const projectedRevenue =
    Number(
      metrics?.weighted_pipeline_value || 0
    );

  const priorityOpportunities =
    [...activeOpportunities]
      .sort(
        (a, b) =>
          Number(
            b.qualification_score || 0
          ) -
          Number(
            a.qualification_score || 0
          ) ||
          Number(
            b.value || 0
          ) -
          Number(
            a.value || 0
          )
      )
      .slice(0, 4);

  const biggestOpportunity =
    [...activeOpportunities]
      .sort(
        (a, b) =>
          Number(b.value || 0) -
          Number(a.value || 0)
      )[0];

  const money = value =>
    new Intl.NumberFormat(
      "en-AU",
      {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0
      }
    ).format(
      Number(value || 0)
    );

  return (
    <div className="page">

      <div className="welcome">
        <div>
          <h2>
            Good morning.
          </h2>

          <p>
            Here's what is happening
            across your growth engine.
          </p>
        </div>

        <button className="primary">
          + New Campaign
        </button>
      </div>

      <div className="metrics">

        <Metric
          label="Pipeline Value"
          value={
            loading
              ? "..."
              : money(
                  metrics?.pipeline_value
                )
          }
          change="Live"
        />

        <Metric
          label="Qualified Leads"
          value={
            loading
              ? "..."
              : String(
                  qualifiedLeads
                )
          }
          change="Live"
        />

        <Metric
          label="Opportunity Score"
          value={
            loading
              ? "..."
              : averageScore
          }
          change="Live"
        />

        <Metric
          label="Projected Revenue"
          value={
            loading
              ? "..."
              : money(
                  projectedRevenue
                )
          }
          change="Weighted pipeline"
        />

      </div>

      <div className="grid-two">

        <section className="card">

          <div className="card-head">
            <div>
              <h3>
                Priority Opportunities
              </h3>

              <p>
                Highest-value prospects
                requiring attention.
              </p>
            </div>

            <button
              className="text-button"
            >
              View all →
            </button>
          </div>

          <div className="opportunity-list">

            {loading ? (
              <div className="pipeline-loading">
                Loading opportunities...
              </div>
            ) : error ? (
              <div className="pipeline-loading">
                Unable to load opportunities.
                <button
                  className="text-button"
                  onClick={refresh}
                >
                  Retry
                </button>
              </div>
            ) : priorityOpportunities.length === 0 ? (
              <div className="pipeline-loading">
                No opportunities yet.
              </div>
            ) : (
              priorityOpportunities.map(
                item => (
                  <div
                    className="opportunity"
                    key={item.id}
                  >

                    <div className="company-icon">
                      {(
                        item.business_name ||
                        "?"
                      )[0].toUpperCase()}
                    </div>

                    <div className="opportunity-main">

                      <strong>
                        {item.business_name ||
                          "Unnamed opportunity"}
                      </strong>

                      <span>
                        {item.service ||
                          "Trade service"}
                        {" · "}
                        {item.location ||
                          "Location unknown"}
                      </span>

                    </div>

                    <div className="score">
                      <strong>
                        {Number(
                          item.qualification_score ||
                            0
                        )}
                      </strong>

                      <span>
                        SCORE
                      </span>
                    </div>

                    <div className="value">
                      {money(
                        item.value
                      )}
                    </div>

                  </div>
                )
              )
            )}

          </div>

        </section>

        <section className="card">

          <div className="card-head">

            <div>
              <h3>
                Pipeline
              </h3>

              <p>
                Current sales movement.
              </p>
            </div>

            <button
              className="text-button"
            >
              Open CRM →
            </button>

          </div>

          <div className="pipeline-summary">

            {loading ? (
              <div className="pipeline-loading">
                Loading live pipeline...
              </div>
            ) : error ? (
              <div className="pipeline-loading">
                Unable to load pipeline.
                <button
                  className="text-button"
                  onClick={refresh}
                >
                  Retry
                </button>
              </div>
            ) : (
              [
                ["New", "NEW"],
                ["Qualified", "QUALIFIED"],
                ["Contacted", "CONTACTED"],
                ["Meeting", "MEETING"]
              ].map(
                ([label, stage]) => {

                  const stageData =
                    metrics?.by_stage?.[stage] || {
                      count: 0,
                      value: 0
                    };

                  const maxCount =
                    Math.max(
                      1,
                      ...Object.values(
                        metrics?.by_stage || {}
                      ).map(
                        item =>
                          Number(
                            item?.count || 0
                          )
                      )
                    );

                  return (
                    <div
                      className="pipeline-row"
                      key={stage}
                    >

                      <span>
                        {label}
                      </span>

                      <div className="bar">
                        <div
                          style={{
                            width:
                              `${Math.min(
                                100,
                                (
                                  stageData.count /
                                  maxCount
                                ) * 100
                              )}%`
                          }}
                        />
                      </div>

                      <strong>
                        {money(
                          stageData.value
                        )}
                      </strong>

                    </div>
                  );
                }
              )
            )}

          </div>

        </section>

      </div>

      <section className="card">

        <div className="card-head">

          <div>
            <h3>
              Growth Intelligence
            </h3>

            <p>
              System-level performance
              signals.
            </p>
          </div>

        </div>

        <div className="intelligence-grid">

          <Insight
            title="Best ICP"
            value={
              activeOpportunities.length
                ? "Active Trade Opportunities"
                : "—"
            }
            text={
              activeOpportunities.length
                ? "Based on the current active opportunity set."
                : "Waiting for opportunity data."
            }
          />

          <Insight
            title="Best Channel"
            value="—"
            text="Channel performance will become data-driven once outreach experiments are connected."
          />

          <Insight
            title="Biggest Opportunity"
            value={
              biggestOpportunity
                ? money(
                    biggestOpportunity.value
                  )
                : "$0"
            }
            text={
              biggestOpportunity
                ? `${biggestOpportunity.business_name || "Opportunity"} currently has the highest estimated value.`
                : "No opportunities available yet."
            }
          />

          <Insight
            title="Next Action"
            value={
              priorityOpportunities.length
                ? `${priorityOpportunities.length} Leads`
                : "None"
            }
            text={
              priorityOpportunities.length
                ? "Review the highest-priority opportunities and prepare the next action."
                : "No priority opportunities currently require attention."
            }
          />

        </div>

      </section>

    </div>
  );
}

function Metric({
  label,
  value,
  change
}) {
  return (
    <div className="metric">

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

      <small>
        {change}
      </small>

    </div>
  );
}

function Insight({
  title,
  value,
  text
}) {
  return (
    <div className="insight">

      <span>
        {title}
      </span>

      <strong>
        {value}
      </strong>

      <p>
        {text}
      </p>

    </div>
  );
}

function Prospects() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(null);
  const [created, setCreated] = useState({});

  async function loadProspects() {
    try {
      setLoading(true);
      setError(null);

      const result = await getProspects();

      const prospects = Array.isArray(result)
        ? result
        : Array.isArray(result?.data)
          ? result.data
          : [];

      setData(prospects);
    } catch (err) {
      console.error(err);
      setError(
        err?.message ||
        "Unable to load prospects."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProspects();
  }, []);

  async function handleCreateOpportunity(prospect) {
    try {
      setCreating(prospect.id);
      setError(null);

      await createOpportunityFromProspect(
        prospect.id
      );

      setCreated(prev => ({
        ...prev,
        [prospect.id]: true
      }));
    } catch (err) {
      console.error(err);

      setError(
        err?.message ||
        "Unable to create opportunity."
      );
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="page">

      <div className="page-actions">
        <div>
          <h2>Prospect Intelligence</h2>
          <p>
            Businesses discovered and
            evaluated by the engine.
          </p>
        </div>

        <button
          className="primary"
          onClick={loadProspects}
          disabled={loading}
        >
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="pipeline-loading">
          {error}
        </div>
      )}

      <div className="card">

        {loading ? (
          <div className="pipeline-loading">
            Loading live prospects...
          </div>
        ) : data.length === 0 ? (
          <div className="pipeline-loading">
            No prospects found yet.
          </div>
        ) : (
          <div className="table">

            <div className="table-row table-head">
              <span>Business</span>
              <span>Service</span>
              <span>Location</span>
              <span>Score</span>
              <span>Status</span>
            </div>

            {data.map(prospect => {

              const wasCreated =
                Boolean(
                  created[prospect.id]
                );

              return (
                <div
                  className="table-row"
                  key={prospect.id}
                >

                  <strong>
                    {prospect.business_name}
                  </strong>

                  <span>
                    {prospect.service || "—"}
                  </span>

                  <span>
                    {prospect.location || "—"}
                  </span>

                  <span className="score-number">
                    {prospect.qualification_score ?? "—"}
                  </span>

                  <span>

                    {wasCreated ? (
                      <span className="status qualified">
                        Opportunity created
                      </span>
                    ) : (
                      <button
                        className="text-button"
                        disabled={
                          creating === prospect.id
                        }
                        onClick={() =>
                          handleCreateOpportunity(
                            prospect
                          )
                        }
                      >
                        {creating === prospect.id
                          ? "Creating..."
                          : "Create opportunity →"}
                      </button>
                    )}

                  </span>

                </div>
              );
            })}

          </div>
        )}

      </div>

    </div>
  );
}

function Pipeline() {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(null);

  const stages = [
    "NEW",
    "QUALIFIED",
    "CONTACTED",
    "REPLIED",
    "MEETING",
    "PROPOSAL",
    "WON",
    "LOST"
  ];

  const loadPipeline = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getOpportunities();

      const items =
        Array.isArray(result)
          ? result
          : Array.isArray(result?.data)
            ? result.data
            : [];

      setOpportunities(items);
    } catch (err) {
      console.error(err);

      setError(
        err?.message ||
        "Unable to load pipeline."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPipeline();
  }, []);

  const money = value =>
    new Intl.NumberFormat(
      "en-AU",
      {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0
      }
    ).format(
      Number(value || 0)
    );

  const handleStageChange =
    async (opportunity, stage) => {

      if (
        stage === opportunity.stage
      ) {
        return;
      }

      try {
        setUpdating(
          opportunity.id
        );

        setError(null);

        const result =
          await updateOpportunityStage(
            opportunity.id,
            stage
          );

        const updated =
          result?.data ||
          result?.opportunity;

        setOpportunities(
          current =>
            current.map(item =>
              item.id ===
              opportunity.id
                ? {
                    ...item,
                    ...(updated || {}),
                    stage
                  }
                : item
            )
        );

      } catch (err) {
        console.error(err);

        setError(
          err?.message ||
          "Unable to update stage."
        );
      } finally {
        setUpdating(null);
      }
    };

  const active =
    opportunities.filter(
      item =>
        item.stage !== "WON" &&
        item.stage !== "LOST"
    );

  const totalValue =
    active.reduce(
      (sum, item) =>
        sum +
        Number(item.value || 0),
      0
    );

  const weightedValue =
    active.reduce(
      (sum, item) =>
        sum +
        Number(
          item.weighted_value ??
          (
            Number(item.value || 0) *
            Number(item.probability || 0) /
            100
          )
        ),
      0
    );

  return (
    <div className="page">

      <div className="page-actions">

        <div>
          <h2>
            Pipeline
          </h2>

          <p>
            Move opportunities through
            the sales process.
          </p>
        </div>

        <button
          className="primary"
          onClick={loadPipeline}
          disabled={loading}
        >
          {loading
            ? "Loading..."
            : "↻ Refresh"}
        </button>

      </div>

      <div className="insight-grid">

        <Insight
          title="Open Pipeline"
          value={money(totalValue)}
          text="Total value of active opportunities."
        />

        <Insight
          title="Weighted Pipeline"
          value={money(weightedValue)}
          text="Pipeline value adjusted by stage probability."
        />

        <Insight
          title="Active Opportunities"
          value={active.length}
          text="Opportunities currently in progress."
        />

      </div>

      {error && (
        <div className="pipeline-loading">
          {error}
        </div>
      )}

      {loading ? (
        <div className="pipeline-loading">
          Loading live pipeline...
        </div>
      ) : (
        <div className="pipeline-board">

          {stages.map(stage => {

            const stageItems =
              opportunities.filter(
                item =>
                  item.stage === stage
              );

            return (
              <div
                className="pipeline-column"
                key={stage}
              >

                <div className="pipeline-column-header">

                  <strong>
                    {stage}
                  </strong>

                  <span>
                    {stageItems.length}
                  </span>

                </div>

                {stageItems.map(
                  opportunity => (

                    <div
                      className="deal-card"
                      key={
                        opportunity.id
                      }
                    >

                      <strong>
                        {
                          opportunity.business_name ||
                          opportunity.name ||
                          "Unnamed opportunity"
                        }
                      </strong>

                      <span>
                        {
                          opportunity.service ||
                          "Opportunity"
                        }
                      </span>

                      <b>
                        {money(
                          opportunity.value
                        )}
                      </b>

                      <span>
                        Score:{" "}
                        {
                          opportunity
                            .qualification_score ??
                          "—"
                        }
                      </span>

                      <select
                        value={
                          opportunity.stage
                        }
                        disabled={
                          updating ===
                          opportunity.id
                        }
                        onChange={event =>
                          handleStageChange(
                            opportunity,
                            event.target.value
                          )
                        }
                      >

                        {stages.map(
                          option => (
                            <option
                              key={option}
                              value={option}
                            >
                              {option}
                            </option>
                          )
                        )}

                      </select>

                    </div>

                  )
                )}

                {stageItems.length === 0 && (
                  <div className="pipeline-empty">
                    No opportunities
                  </div>
                )}

              </div>
            );
          })}

        </div>
      )}

    </div>
  );
}

function Opportunities() {
  const {
    opportunities = [],
    loading,
    error,
    refresh
  } = usePipelineData();

  const [selected, setSelected] =
    useState(null);

  const [activities, setActivities] =
    useState([]);

  const [activitiesLoading, setActivitiesLoading] =
    useState(false);

  const [activityError, setActivityError] =
    useState(null);

  const [tasks, setTasks] =
    useState([]);

  const [tasksLoading, setTasksLoading] =
    useState(false);

  const [taskError, setTaskError] =
    useState(null);

  const [showTaskForm, setShowTaskForm] =
    useState(false);

  const [taskTitle, setTaskTitle] =
    useState("");

  const [taskDescription, setTaskDescription] =
    useState("");

  const [taskDueAt, setTaskDueAt] =
    useState("");

  const [taskPriority, setTaskPriority] =
    useState("MEDIUM");

  const money = value =>
    new Intl.NumberFormat(
      "en-AU",
      {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0
      }
    ).format(Number(value || 0));

  const loadActivities =
    async opportunity => {
      if (!opportunity?.id) return;

      try {
        setActivitiesLoading(true);
        setActivityError(null);

        const result =
          await getOpportunityActivities(
            opportunity.id
          );

        const items =
          Array.isArray(result)
            ? result
            : Array.isArray(result?.data)
              ? result.data
              : [];

        setActivities(items);
      } catch (err) {
        console.error(err);

        setActivityError(
          err?.message ||
          "Unable to load activity."
        );
      } finally {
        setActivitiesLoading(false);
      }
    };

  const loadTasks =
    async opportunity => {
      if (!opportunity?.id) return;

      try {
        setTasksLoading(true);
        setTaskError(null);

        const result =
          await getOpportunityTasks(
            opportunity.id
          );

        const items =
          Array.isArray(result)
            ? result
            : Array.isArray(result?.data)
              ? result.data
              : [];

        setTasks(items);
      } catch (err) {
        console.error(err);

        setTaskError(
          err?.message ||
          "Unable to load tasks."
        );
      } finally {
        setTasksLoading(false);
      }
    };


  useEffect(() => {
    const selectFromHash = () => {
      const match = window.location.hash
        .replace(/^#\/?/, "")
        .match(/^opportunities\/([^/]+)$/);

      if (!match) {
        setSelected(null);
        return;
      }

      const opportunity = opportunities.find(
        item => item.id === match[1]
      );

      if (opportunity) {
        setSelected(opportunity);
      }
    };

    selectFromHash();

    window.addEventListener(
      "hashchange",
      selectFromHash
    );

    return () => {
      window.removeEventListener(
        "hashchange",
        selectFromHash
      );
    };
  }, [opportunities]);

  const openOpportunity = opportunity => {
    setSelected(opportunity);
    window.location.hash = `opportunities/${opportunity.id}`;
  };

  const legacyOpenOpportunity =
    async opportunity => {
      setSelected(opportunity);

      await Promise.all([
        loadActivities(opportunity),
        loadTasks(opportunity)
      ]);
    };

  const closeOpportunity = () => {
    window.location.hash = "opportunities";
    setSelected(null);
    setActivities([]);
    setTasks([]);
    setActivityError(null);
    setTaskError(null);
    setShowTaskForm(false);
  }

;

  const handleCreateTask =
    async event => {
      event.preventDefault();

      if (
        !selected ||
        !taskTitle.trim()
      ) {
        return;
      }

      try {
        setTaskError(null);

        await createTask({
          opportunity_id:
            selected.id,

          title:
            taskTitle.trim(),

          description:
            taskDescription.trim(),

          due_at:
            taskDueAt
              ? new Date(
                  taskDueAt
                ).toISOString()
              : null,

          priority:
            taskPriority
        });

        setTaskTitle("");
        setTaskDescription("");
        setTaskDueAt("");
        setTaskPriority("MEDIUM");
        setShowTaskForm(false);

        await Promise.all([
          loadTasks(selected),
          loadActivities(selected)
        ]);
      } catch (err) {
        console.error(err);

        setTaskError(
          err?.message ||
          "Unable to create task."
        );
      }
    };

  const handleCompleteTask =
    async task => {
      if (!task?.id) return;

      try {
        setTaskError(null);

        await updateTask(
          task.id,
          {
            status: "COMPLETED"
          }
        );

        await Promise.all([
          loadTasks(selected),
          loadActivities(selected)
        ]);
      } catch (err) {
        console.error(err);

        setTaskError(
          err?.message ||
          "Unable to complete task."
        );
      }
    };

  /*
   * ----------------------------------------------------------
   * OPPORTUNITY WORKSPACE
   * ----------------------------------------------------------
   */

  if (selected) {
    return (
      <OpportunityCommandCenter
        opportunity={selected}
        onBack={closeOpportunity}
        onOpportunityUpdated={updated => {
          setSelected(updated);
          refresh();
        }}
      />
    );

    /*
     * Legacy opportunity workspace retained below
     * for the next UI migration.
     */

    const value =
      Number(
        selected.value || 0
      );

    const probability =
      Number(
        selected.probability || 0
      );

    const weighted =
      Number(
        selected.weighted_value ??
        value *
          (probability / 100)
      );

    return (
      <div className="page">

        <div className="page-actions">

          <div>

            <button
              className="text-button"
              onClick={
                closeOpportunity
              }
            >
              ← Back to opportunities
            </button>

            <h2>
              {
                selected.business_name ||
                "Opportunity"
              }
            </h2>

            <p>
              {
                selected.service ||
                "Trade service"
              }
              {" · "}
              {
                selected.location ||
                "Unknown location"
              }
            </p>

          </div>

          <button
            className="primary"
            onClick={
              async () => {
                await refresh();

                await Promise.all([
                  loadTasks(selected),
                  loadActivities(selected)
                ]);
              }
            }
          >
            ↻ Refresh
          </button>

        </div>

        <div className="insight-grid">

          <Insight
            title="Value"
            value={money(value)}
            text="Estimated opportunity value."
          />

          <Insight
            title="Score"
            value={
              selected.qualification_score ??
              "—"
            }
            text="Qualification score."
          />

          <Insight
            title="Probability"
            value={
              `${probability}%`
            }
            text="Current stage probability."
          />

          <Insight
            title="Weighted Value"
            value={
              money(weighted)
            }
            text="Probability-adjusted pipeline value."
          />

        </div>

        <section className="card">

          <div className="section-header">

            <div>

              <h3>
                Opportunity Details
              </h3>

              <p>
                Current sales state and next action.
              </p>

            </div>

          </div>

          <div className="detail-grid">

            <div className="detail-item">
              <span>
                Stage
              </span>

              <strong>
                {
                  selected.stage ||
                  "UNKNOWN"
                }
              </strong>
            </div>

            <div className="detail-item">
              <span>
                Next Action
              </span>

              <strong>
                {
                  selected.next_action ||
                  "No next action set"
                }
              </strong>
            </div>

            <div className="detail-item">
              <span>
                Website
              </span>

              <strong>
                {
                  selected.website ||
                  "—"
                }
              </strong>
            </div>

            <div className="detail-item">
              <span>
                Opportunity ID
              </span>

              <strong>
                {selected.id}
              </strong>
            </div>

          </div>

        </section>

        {/* -------------------------------------------------- */}
        {/* TASKS                                               */}
        {/* -------------------------------------------------- */}

        <section className="card">

          <div className="section-header">

            <div>

              <h3>
                Tasks
              </h3>

              <p>
                Actions and follow-ups for this opportunity.
              </p>

            </div>

            <button
              className="primary"
              onClick={() =>
                setShowTaskForm(
                  value => !value
                )
              }
            >
              {
                showTaskForm
                  ? "Cancel"
                  : "+ Add Task"
              }
            </button>

          </div>

          {showTaskForm && (

            <form
              onSubmit={
                handleCreateTask
              }
              className="task-form"
            >

              <input
                value={taskTitle}
                onChange={
                  event =>
                    setTaskTitle(
                      event.target.value
                    )
                }
                placeholder="Task title"
                required
              />

              <textarea
                value={
                  taskDescription
                }
                onChange={
                  event =>
                    setTaskDescription(
                      event.target.value
                    )
                }
                placeholder="Description"
                rows="3"
              />

              <div className="task-form-row">

                <input
                  type="datetime-local"
                  value={
                    taskDueAt
                  }
                  onChange={
                    event =>
                      setTaskDueAt(
                        event.target.value
                      )
                  }
                />

                <select
                  value={
                    taskPriority
                  }
                  onChange={
                    event =>
                      setTaskPriority(
                        event.target.value
                      )
                  }
                >

                  <option value="LOW">
                    Low
                  </option>

                  <option value="MEDIUM">
                    Medium
                  </option>

                  <option value="HIGH">
                    High
                  </option>

                  <option value="URGENT">
                    Urgent
                  </option>

                </select>

              </div>

              <button
                className="primary"
                type="submit"
              >
                Create Task
              </button>

            </form>

          )}

          {taskError && (

            <div className="pipeline-loading">
              {taskError}
            </div>

          )}

          {tasksLoading ? (

            <div className="pipeline-loading">
              Loading tasks...
            </div>

          ) : tasks.length === 0 ? (

            <div className="pipeline-loading">
              No tasks yet.
            </div>

          ) : (

            <div className="task-list">

              {tasks.map(task => (

                <div
                  className="task-item"
                  key={task.id}
                >

                  <div className="task-main">

                    <div className="task-heading">

                      <strong>
                        {task.title}
                      </strong>

                      <span
                        className={
                          `task-priority task-priority-${String(
                            task.priority
                          ).toLowerCase()}`
                        }
                      >
                        {task.priority}
                      </span>

                    </div>

                    {task.description && (

                      <p>
                        {task.description}
                      </p>

                    )}

                    <small>

                      {task.status}

                      {task.due_at
                        ? ` · Due ${new Date(
                            task.due_at
                          ).toLocaleString(
                            "en-AU"
                          )}`
                        : ""}

                    </small>

                  </div>

                  {task.status !==
                    "COMPLETED" && (

                    <button
                      className="text-button"
                      onClick={() =>
                        handleCompleteTask(
                          task
                        )
                      }
                    >
                      Complete
                    </button>

                  )}

                </div>

              ))}

            </div>

          )}

        </section>

        {/* -------------------------------------------------- */}
        {/* ACTIVITY TIMELINE                                   */}
        {/* -------------------------------------------------- */}

        <section className="card">

          <div className="section-header">

            <div>

              <h3>
                Activity Timeline
              </h3>

              <p>
                Persisted CRM activity for this opportunity.
              </p>

            </div>

            <button
              className="text-button"
              onClick={() =>
                loadActivities(
                  selected
                )
              }
              disabled={
                activitiesLoading
              }
            >
              {
                activitiesLoading
                  ? "Loading..."
                  : "↻ Refresh activity"
              }
            </button>

          </div>

          {activityError && (

            <div className="pipeline-loading">
              {activityError}
            </div>

          )}

          {activitiesLoading ? (

            <div className="pipeline-loading">
              Loading activity...
            </div>

          ) : activities.length === 0 ? (

            <div className="pipeline-loading">
              No activity recorded yet.
            </div>

          ) : (

            <div className="activity-timeline">

              {activities.map(
                activity => (

                  <div
                    className="activity-item"
                    key={
                      activity.id
                    }
                  >

                    <div className="activity-dot">
                      ●
                    </div>

                    <div className="activity-content">

                      <strong>
                        {
                          activity.description ||
                          activity.type
                        }
                      </strong>

                      <span>
                        {
                          new Date(
                            activity.created_at
                          ).toLocaleString(
                            "en-AU"
                          )
                        }
                      </span>

                      {activity.metadata && (

                        <small>

                          {
                            activity.metadata.stage
                              ? `Stage: ${activity.metadata.stage}`
                              : ""
                          }

                          {
                            activity.metadata.probability != null
                              ? ` · Probability: ${
                                  Number(
                                    activity.metadata.probability
                                  ) * 100
                                }%`
                              : ""
                          }

                        </small>

                      )}

                    </div>

                  </div>

                )
              )}

            </div>

          )}

        </section>

      </div>
    );
  }

  /*
   * ----------------------------------------------------------
   * OPPORTUNITY INTELLIGENCE TABLE
   * ----------------------------------------------------------
   */

  return (
    <div className="page">

      <div className="page-actions">

        <div>

          <h2>
            Opportunity Intelligence
          </h2>

          <p>
            Qualified opportunities and their commercial potential.
          </p>

        </div>

        <button
          className="primary"
          onClick={refresh}
          disabled={loading}
        >
          {
            loading
              ? "Loading..."
              : "↻ Refresh"
          }
        </button>

      </div>

      {error && (

        <div className="pipeline-loading">
          {error}
        </div>

      )}

      <section className="card">

        {loading ? (

          <div className="pipeline-loading">
            Loading opportunities...
          </div>

        ) : opportunities.length === 0 ? (

          <div className="pipeline-loading">
            No opportunities found.
          </div>

        ) : (

          <div className="opportunity-table">

            <div className="opportunity-table-header">

              <span>
                Business
              </span>

              <span>
                Score
              </span>

              <span>
                Value
              </span>

              <span>
                Probability
              </span>

              <span>
                Weighted
              </span>

              <span>
                Stage
              </span>

            </div>

            {opportunities.map(
              opportunity => {

                const score =
                  Number(
                    opportunity.qualification_score ||
                    0
                  );

                const value =
                  Number(
                    opportunity.value ||
                    0
                  );

                const probability =
                  Number(
                    opportunity.probability ||
                    0
                  );

                const weighted =
                  Number(
                    opportunity.weighted_value ??
                    value *
                      (probability / 100)
                  );

                return (

                  <button
                    className="opportunity-table-row"
                    data-testid={`opportunity-row-${opportunity.id}`}
                    key={
                      opportunity.id
                    }
                    onClick={() =>
                      openOpportunity(opportunity)
                    }
                  >

                    <div>

                      <strong>
                        {
                          opportunity.business_name ||
                          "Unnamed opportunity"
                        }
                      </strong>

                      <span>
                        {
                          opportunity.service ||
                          "Trade service"
                        }
                      </span>

                    </div>

                    <strong>
                      {score}
                    </strong>

                    <span>
                      {money(value)}
                    </span>

                    <span>
                      {probability}%
                    </span>

                    <span>
                      {money(weighted)}
                    </span>

                    <span className="stage">
                      {
                        opportunity.stage ||
                        "UNKNOWN"
                      }
                    </span>

                  </button>

                );
              }
            )}

          </div>

        )}

      </section>

    </div>
  );
}

function Reports() {
  return (
    <EmptyPage
      title="Reports"
      description="Generate decision-ready reports from your growth data."
    />
  );
}

function Settings() {
  return (
    <EmptyPage
      title="Settings"
      description="Configure your growth engine, integrations, users and operating preferences."
    />
  );
}

createRoot(
  document.getElementById(
    "root"
  )
).render(
  <App />
);
