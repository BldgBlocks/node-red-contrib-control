module.exports = function (RED) {
  function InfluxDBQueryNode(config) {
    RED.nodes.createNode(this, config);
    this.influxConfig = RED.nodes.getNode(config.influxConfig);
    this.bucket = config.bucket || "Undefined";
    this.defaultTimeSpan = parseInt(config.defaultTimeSpan) || 604800;
    const node = this;

    node.on("input", function (msg) {
      if (!node.influxConfig) {
        node.error("No InfluxDB configuration defined", msg);
        return;
      }

      try {
        const token = node.influxConfig.token;
        if (!token) {
          node.error("No token provided in InfluxDB configuration", msg);
          return;
        }

        // Use configured bucket or msg.bucket if provided
        const bucket = msg.bucket || node.bucket;
        if (!bucket || bucket === "Undefined") {
          node.error("No valid bucket specified", msg);
          return;
        }

        // Extract timeSpan
        let timeSpan;
        if (Number.isInteger(parseInt(msg.timeSpan))) {
          timeSpan = parseInt(msg.timeSpan);
        } else if (
          msg.req &&
          msg.req.query &&
          Number.isInteger(parseInt(msg.req.query.timeSpan))
        ) {
          timeSpan = parseInt(msg.req.query.timeSpan);
        } else {
          timeSpan = node.defaultTimeSpan;
        }

        // Ensure timeSpan is positive
        if (timeSpan <= 0) {
          node.error("Invalid timeSpan: Must be a positive integer", msg);
          return;
        }

        // Set msg.bucket and msg.timeSpan
        msg.bucket = bucket;
        msg.timeSpan = timeSpan;

        // Build query (fetch all data in bucket)
        const query = `
                    SELECT time, "seriesName", value
                    FROM sensor_data
                    WHERE time >= now() - INTERVAL '${timeSpan} SECOND'
                    ORDER BY time
                `;

        // Prepare HTTP request
        const isV3 = node.influxConfig.version === "3";
        const endpoint = isV3 ? "/api/v3/query_sql" : "/api/v2/query";
        msg.url = `http://${node.influxConfig.host}:${node.influxConfig.port}${endpoint}`;
        msg.method = "POST";
        msg.headers = {
          Authorization: isV3 ? `Bearer ${token}` : `Token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        msg.payload = {
          db: node.influxConfig.database,
          q: query,
        };

        node.send(msg);
      } catch (e) {
        node.error(`Failed to prepare request: ${e.message}`, msg);
      }
    });
  }
  RED.nodes.registerType("influxdb-query", InfluxDBQueryNode);
};