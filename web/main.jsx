import OpportunityCommandCenter from "./components/OpportunityCommandCenter.jsx";
import RevenueCommandCenter from "./components/RevenueCommandCenter.jsx";
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
  updateOpportunityStage
} from "./lib/api";
import {
  formatCommercialValue,
  isKnownCommercialValue
} from "./lib/commercialValue";

const nav = [
  ["dashboard", "Dashboard"],
  ["prospects", "Prospects"],
  ["opportunities", "Opportunities"],
  ["pipeline", "Pipeline"]
];

const money = formatCommercialValue;

function commercialAmount(value) {
  return isKnownCommercialValue(value)
    ? Number(value)
    : 0;
}

function pageFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");

  if (hash.startsWith("opportunities/")) {
    return "opportunities";
  }

  return nav.some(([id]) => id === hash)
    ? hash
    : "dashboard";
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

        {nav.map(
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
                onChange={e => {
                  const value = e.target.value;
                  setSearch(value);

                  if (value.trim()) {
                    navigatePage("prospects");
                  }
                }}
                placeholder="Search prospects..."
              />
            </div>

            <button className="avatar">
              Y
            </button>

          </div>

        </header>

        {page === "dashboard" && (
          <Dashboard onNavigate={navigatePage} />
        )}

        {page === "prospects" && (
          <Prospects searchTerm={search} />
        )}

        {page === "pipeline" && (
          <Pipeline />
        )}

        {page === "opportunities" && (
          <Opportunities />
        )}

      </main>

    </div>
  );
}

function Dashboard({ onNavigate }) {
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
    metrics?.weighted_pipeline_value;

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
          commercialAmount(b.value) -
          commercialAmount(a.value)
      )
      .slice(0, 4);

  const biggestOpportunity =
    [...activeOpportunities]
      .filter(item =>
        isKnownCommercialValue(
          item.value
        )
      )
      .sort(
        (a, b) =>
          commercialAmount(b.value) -
          commercialAmount(a.value)
      )[0];

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
              onClick={() => onNavigate("opportunities")}
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
              onClick={() => onNavigate("pipeline")}
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
              money(
                biggestOpportunity?.value
              )
            }
            text={
              biggestOpportunity &&
              isKnownCommercialValue(
                biggestOpportunity.value
              )
                ? `${biggestOpportunity.business_name || "Opportunity"} currently has the highest estimated value.`
                : "No known opportunity value is currently recorded."
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

function Prospects({ searchTerm = "" }) {
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

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();

    if (!term) {
      return data;
    }

    return data.filter(prospect =>
      [
        prospect.business_name,
        prospect.service,
        prospect.location
      ].some(value =>
        String(value || "")
          .toLowerCase()
          .includes(term)
      )
    );
  }, [data, searchTerm]);

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
        ) : filteredData.length === 0 ? (
          <div className="pipeline-loading">
            {searchTerm.trim()
              ? "No matching prospects found."
              : "No prospects found yet."}
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

            {filteredData.map(prospect => {

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
        commercialAmount(item.value),
      0
    );

  const weightedValue =
    active.reduce(
      (sum, item) => {
        const candidate =
          item.weighted_value ??
          (
            commercialAmount(item.value) *
            Number(item.probability || 0) /
            100
          );

        return sum +
          commercialAmount(candidate);
      },
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
    revenue,
    revenueLoading,
    revenueError,
    loading,
    error,
    refresh,
    refreshRevenue
  } = usePipelineData();

  const [selected, setSelected] =
    useState(null);

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

  const closeOpportunity = () => {
    window.location.hash = "opportunities";
    setSelected(null);
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
        onOpportunityUpdated={async updated => {
          setSelected(updated);
          await Promise.all([
            refresh(),
            refreshRevenue()
          ]);
        }}
      />
    );
  }

  /*
   * ----------------------------------------------------------
   * OPPORTUNITY INTELLIGENCE TABLE
   * ----------------------------------------------------------
   */

  return (
    <div className="page">

      <RevenueCommandCenter
        revenue={revenue}
        loading={revenueLoading}
        error={revenueError}
        onRefresh={refreshRevenue}
        onOpenOpportunity={opportunityId => {
          const opportunity = opportunities.find(
            item => item.id === opportunityId
          );

          if (opportunity) {
            openOpportunity(opportunity);
          }
        }}
      />

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

                const probability =
                  Number(
                    opportunity.probability ||
                    0
                  );

                const weighted =
                  opportunity.weighted_value ??
                  commercialAmount(
                    opportunity.value
                  ) *
                    (probability / 100);

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
                      {money(opportunity.value)}
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

createRoot(
  document.getElementById(
    "root"
  )
).render(
  <App />
);
