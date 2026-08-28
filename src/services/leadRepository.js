const {
  getSupabase
} = require(
  "../integrations/supabase"
);

async function listLeads({
  limit = 100,
  offset = 0
} = {}) {
  const supabase =
    getSupabase();

  if (!supabase) {
    return {
      data: [],
      count: 0,
      persisted: false
    };
  }

  const {
    data,
    error,
    count
  } =
    await supabase
      .from("leads")
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

    persisted: true
  };
}

async function createLead(
  lead
) {
  const supabase =
    getSupabase();

  if (!supabase) {
    return {
      data: lead,
      persisted: false
    };
  }

  const {
    data,
    error
  } =
    await supabase
      .from("leads")
      .insert(
        lead
      )
      .select()
      .single();

  if (error) {
    throw error;
  }

  return {
    data,
    persisted: true
  };
}

module.exports = {
  listLeads,
  createLead
};
