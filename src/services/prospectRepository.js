const {
  getSupabase
} = require(
  "../integrations/supabase"
);

const {
  readCollection,
  createRecord
} = require(
  "./localStore"
);

async function listProspects({
  limit = 100,
  offset = 0
} = {}) {
  const supabase =
    getSupabase();

  if (!supabase) {
    const records =
      readCollection(
        "prospects"
      );

    const data =
      records.slice(
        offset,
        offset + limit
      );

    return {
      data,
      count:
        records.length,
      persisted: true,
      storage:
        "local"
    };
  }

  const {
    data,
    error,
    count
  } =
    await supabase
      .from("prospects")
      .select(
        "*",
        {
          count: "exact"
        }
      )
      .range(
        offset,
        offset + limit - 1
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

  if (error) {
    throw error;
  }

  return {
    data:
      data || [],

    count:
      count || 0,

    persisted: true,

    storage:
      "supabase"
  };
}

async function createProspect(
  prospect
) {
  const supabase =
    getSupabase();

  if (!supabase) {
    const record =
      createRecord(
        "prospects",
        {
          ...prospect,

          qualification_status:
            prospect
              .qualification_status ||
            "DISCOVERED"
        }
      );

    return {
      data: record,
      persisted: true,
      storage:
        "local"
    };
  }

  const {
    data,
    error
  } =
    await supabase
      .from("prospects")
      .insert(
        prospect
      )
      .select()
      .single();

  if (error) {
    throw error;
  }

  return {
    data,
    persisted: true,
    storage:
      "supabase"
  };
}

module.exports = {
  listProspects,
  createProspect
};
