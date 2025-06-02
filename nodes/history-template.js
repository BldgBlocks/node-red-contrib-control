module.exports = function(RED) {
    function HistoryTemplateNode(config) {
        RED.nodes.createNode(this, config);
        this.chartConfig = RED.nodes.getNode(config.chartConfig);
        this.name = config.name;
        const node = this;

        node.on('input', function(msg) {
            if (!node.chartConfig) {
                node.error("No chart configuration defined", msg);
                return;
            }
            const bucket = node.chartConfig.name || 'default';
            const bucketData = node.context().flow.get(`chart_data_${bucket}`) || {};

            // Date range filtering
            let startTime = msg.range && msg.range.start ? parseFloat(msg.range.start) : null;
            let endTime = msg.range && msg.range.end ? parseFloat(msg.range.end) : null;

            let series = [{}];
            let data = [[]];

            for (let seriesName in bucketData) {
                let seriesData = bucketData[seriesName] || [];
                
                if (startTime || endTime) {
                    seriesData = seriesData.filter(point => {
                        const ts = point.timestamp;
                        return (!startTime || ts >= startTime) && (!endTime || ts <= endTime);
                    });
                }

                // Get series config from chartConfig
                const seriesConfig = node.chartConfig.series.find(s => s.seriesName === seriesName) || {};
                series.push({ 
                    label: seriesName,
                    units: seriesConfig.seriesUnits || '',
                    color: seriesConfig.seriesColor || '#000000'
                });
                let values = [];

                for (let i = Math.max(0, seriesData.length - 100000); i < seriesData.length; i++) {
                    if (i >= data[0].length) {
                        data[0].push(Math.floor(seriesData[i].timestamp));
                        for (let j = 1; j < data.length; j++) {
                            while (data[j].length < data[0].length) {
                                data[j].push(NaN);
                            }
                        }
                    }
                    values.push(seriesData[i].value !== null ? seriesData[i].value : NaN);
                }

                data.push(values);
            }

            for (let i = 1; i < data.length; i++) {
                while (data[i].length < data[0].length) {
                    data[i].push(NaN);
                }
            }

            const chartData = {
                series: series,
                data: data
            };

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ECharts - ${bucket}</title>
  <script src="/echarts.min.js"></script>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      font-family: sans-serif;
    }
    #main {
      width: 100vw;
      height: 100vh;
    }
  </style>
</head>
<body>
  <div id="main"></div>
  <script>
    const data = ${JSON.stringify(chartData)};
    if (!data.series || !data.data || data.series.length < 1) {
      console.error('Invalid data format:', data);
    } else {
      const timestamps = data.data[0].map(t => t * 1000);
      const legendData = data.series.slice(1).map(s => s.label);
      const seriesData = data.data.slice(1).map((values, i) => ({
        name: data.series[i + 1].label,
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: timestamps.map((t, j) => [t, values[j]]),
        lineStyle: { color: data.series[i + 1].color },
        itemStyle: { color: data.series[i + 1].color }
      }));

      // Calculate data min/max for padding
      let dataMin = Infinity, dataMax = -Infinity;
      data.data.slice(1).forEach(values => {
        values.forEach(v => {
          if (!isNaN(v)) {
            dataMin = Math.min(dataMin, v);
            dataMax = Math.max(dataMax, v);
          }
        });
      });
      if (dataMin === Infinity) dataMin = 0;
      if (dataMax === -Infinity) dataMax = 100;
      const range = dataMax - dataMin;
      const padding = range * 0.5 || 10; // 50% padding or 10 units if range is 0
      const paddedMin = Number((dataMin - padding).toFixed(2));
      const paddedMax = Number((dataMax + padding).toFixed(2));

      // Build y-axis label with units
      const yAxisName = data.series.slice(1).map(s => s.units).filter(u => u).join(', ') || 'Value';

      const chart = echarts.init(document.getElementById('main'), null, { renderer: 'svg' });
      chart.setOption({
        title: {
          text: '${bucket}',
          left: 'center'
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross' },
          formatter: function(params) {
            const date = new Date(params[0].value[0]);
            let result = date.toLocaleString();
            params.forEach(p => {
              const series = data.series[p.seriesIndex + 1];
              const value = p.value[1];
              if (value !== null && !isNaN(value)) {
                result += '<br/>' + series.label + ': ' + value.toFixed(2) + ' ' + (series.units || '');
              }
            });
            return result;
          }
        },
        legend: {
          data: legendData,
          top: 30,
          type: 'scroll'
        },
        xAxis: {
          type: 'time',
          name: 'Time'
        },
        yAxis: {
          type: 'value',
          name: yAxisName,
          min: paddedMin,
          max: paddedMax
        },
        toolbox: {
          feature: {
            dataZoom: { yAxisIndex: 'all' },
            restore: {},
            saveAsImage: {}
          }
        },
        dataZoom: [
          { type: 'slider', xAxisIndex: 0, filterMode: 'filter' },
          { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
          { 
            type: 'inside', 
            yAxisIndex: 0, 
            filterMode: 'filter',
            minValueSpan: paddedMin - 10,
            maxValueSpan: paddedMax + 10
          }
        ],
        series: seriesData
      });
    }
  </script>
</body>
</html>
            `;
            msg.payload = html;
            msg.statusCode = 200;
            node.send(msg);
        });
    }
    RED.nodes.registerType("history-template", HistoryTemplateNode);
};