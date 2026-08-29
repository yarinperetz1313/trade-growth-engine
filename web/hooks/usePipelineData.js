import {
  useCallback,
  useEffect,
  useState
} from "react";

import {
  getOpportunities,
  getPipelineMetrics,
  getRevenueIntelligence
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
    revenue,
    setRevenue
  ] = useState(null);

  const [
    revenueLoading,
    setRevenueLoading
  ] = useState(true);

  const [
    revenueError,
    setRevenueError
  ] = useState(null);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    error,
    setError
  ] = useState(null);

  const refreshRevenue =
    useCallback(
      async () => {
        setRevenueLoading(true);
        setRevenueError(null);

        try {
          const revenueResponse =
            await getRevenueIntelligence();

          setRevenue(
            revenueResponse?.data ||
              null
          );
        } catch (err) {
          setRevenueError(
            err instanceof Error
              ? err.message
              : "Unable to load revenue intelligence"
          );
        } finally {
          setRevenueLoading(false);
        }
      },
      []
    );

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
    refreshRevenue();
  }, [refresh, refreshRevenue]);

  return {
    metrics,
    opportunities,
    revenue,
    revenueLoading,
    revenueError,
    loading,
    error,
    refresh,
    refreshRevenue
  };
}
