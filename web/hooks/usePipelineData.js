import {
  useCallback,
  useEffect,
  useState
} from "react";

import {
  getOpportunities,
  getPipelineMetrics
} from "../lib/api";

export default function usePipelineData() {
  const [
    metrics,
    setMetrics
  ] = useState(null);

  const [
    opportunities,
    setOpportunities
  ] = useState([]);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    error,
    setError
  ] = useState(null);

  const refresh =
    useCallback(
      async () => {
        setLoading(true);
        setError(null);

        try {
          const [
            metricsResponse,
            opportunitiesResponse
          ] = await Promise.all([
            getPipelineMetrics(),
            getOpportunities()
          ]);

          setMetrics(
            metricsResponse?.data ||
              null
          );

          setOpportunities(
            opportunitiesResponse?.data ||
              []
          );
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load pipeline"
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    metrics,
    opportunities,
    loading,
    error,
    refresh
  };
}
