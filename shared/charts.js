/*
 * charts.js — themeable ECharts option builders (global `Charts`)
 *
 * Every builder: Charts.<name>(domEl, payload, theme) -> echarts instance.
 * theme = { text, sub, axis, split, bg, tip, palette:[...], font }
 * Consumes the analyzer-shaped payloads verbatim (see data.js).
 * Requires ECharts global (loaded via <script> from CDN or vendored).
 */
(function () {
  const has = () => typeof window.echarts !== 'undefined';
  const C = {};

  function base(theme) {
    return {
      textStyle: { fontFamily: theme.font, color: theme.text },
      grid: { left: 46, right: 16, top: 26, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme.tip || 'rgba(20,24,34,.94)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontFamily: theme.font, fontSize: 12 },
      },
      xAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: theme.axis } },
        axisLabel: { color: theme.sub, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.sub, fontSize: 11 },
        splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
      },
    };
  }

  function mount(dom, opt) {
    if (!has()) { dom.innerHTML = '<div style="padding:14px;opacity:.6;font-size:12px">ECharts not loaded (needs network for CDN).</div>'; return null; }
    const inst = window.echarts.getInstanceByDom(dom) || window.echarts.init(dom, null, { renderer: 'canvas' });
    inst.setOption(opt, true);
    return inst;
  }

  // ---- SLO CDFs (TTFT / TPOT / E2E) ---------------------------------------
  C.slo = (dom, slo, theme) => {
    const keys = ['ttft', 'tpot', 'e2e'];
    const series = keys.map((k, i) => {
      const s = slo[k], col = theme.palette[i % theme.palette.length];
      return {
        name: s.label + ' (' + s.unit + ')', type: 'line', smooth: true, symbol: 'none',
        data: s.x.map((x, j) => [x, s.y_pct[j]]),
        lineStyle: { width: 2.4, color: col },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: col, opacity: 0.5, type: 'dotted' },
          label: { formatter: 'p90', color: theme.sub, fontSize: 10 },
          data: [{ xAxis: s.markers.p90 }],
        },
      };
    });
    const opt = base(theme);
    opt.legend = { top: 0, right: 0, textStyle: { color: theme.sub, fontSize: 11 }, itemWidth: 14, itemHeight: 8 };
    opt.grid.top = 30;
    opt.xAxis.name = 'latency'; opt.xAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.xAxis.type = 'log'; opt.xAxis.min = 1;
    opt.yAxis.max = 100; opt.yAxis.name = 'CDF %'; opt.yAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.series = series;
    return mount(dom, opt);
  };

  // ---- throughput (stacked prefill/decode over time) ----------------------
  C.throughput = (dom, tp, theme) => {
    const t = tp.t_end_ms.map((v) => +(v / 1000).toFixed(1));
    const mk = (name, arr, col) => ({
      name, type: 'line', stack: 'tok', smooth: true, symbol: 'none', areaStyle: { opacity: 0.85, color: col },
      lineStyle: { width: 0 }, data: arr.map((v, i) => [t[i], v]), color: col,
    });
    const opt = base(theme);
    opt.legend = { top: 0, right: 0, textStyle: { color: theme.sub, fontSize: 11 }, itemWidth: 14, itemHeight: 8 };
    opt.grid.top = 30;
    opt.xAxis.name = 's'; opt.xAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.yAxis.name = 'tok/s'; opt.yAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.series = [mk('prefill', tp.prefill, theme.palette[1]), mk('decode', tp.decode, theme.palette[0])];
    return mount(dom, opt);
  };

  // ---- utilization (per-pool, 0..100%) ------------------------------------
  C.utilization = (dom, util, theme) => {
    const t = util.t_ms.map((v) => +(v / 1000).toFixed(1));
    const opt = base(theme);
    opt.legend = { top: 0, right: 0, textStyle: { color: theme.sub, fontSize: 11 }, itemWidth: 14, itemHeight: 8 };
    opt.grid.top = 30;
    opt.yAxis.max = 100; opt.yAxis.name = 'busy %'; opt.yAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.xAxis.name = 's'; opt.xAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.series = util.series.map((s, i) => ({
      name: s.label, type: 'line', smooth: true, symbol: 'none',
      data: s.util.map((v, j) => [t[j], +(v * 100).toFixed(1)]),
      lineStyle: { width: 2.2, color: theme.palette[i % theme.palette.length] },
      areaStyle: { opacity: 0.12, color: theme.palette[i % theme.palette.length] },
    }));
    return mount(dom, opt);
  };

  // ---- KV occupancy (tokens vs capacity) ----------------------------------
  C.kv = (dom, kv, theme) => {
    const t = kv.t_ms.map((v) => +(v / 1000).toFixed(1));
    const opt = base(theme);
    opt.legend = { top: 0, right: 0, textStyle: { color: theme.sub, fontSize: 11 }, itemWidth: 14, itemHeight: 8 };
    opt.grid.top = 30;
    opt.yAxis.name = 'KV %'; opt.yAxis.max = 100; opt.yAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.xAxis.name = 's'; opt.xAxis.nameTextStyle = { color: theme.sub, fontSize: 10 };
    opt.series = kv.series.map((s, i) => ({
      name: s.label + ' KV', type: 'line', smooth: true, symbol: 'none',
      data: s.active.map((v, j) => [t[j], +((v / s.capacity) * 100).toFixed(1)]),
      lineStyle: { width: 2.2, color: theme.palette[(i + 2) % theme.palette.length] },
      areaStyle: { opacity: 0.16, color: theme.palette[(i + 2) % theme.palette.length] },
    }));
    return mount(dom, opt);
  };

  // ---- kernel time-share donut (by semantic group) ------------------------
  C.kernelDonut = (dom, kernel, theme) => {
    const opt = {
      textStyle: { fontFamily: theme.font },
      tooltip: { trigger: 'item', backgroundColor: theme.tip || 'rgba(20,24,34,.94)', borderWidth: 0,
        textStyle: { color: '#fff', fontFamily: theme.font }, formatter: (p) => `${p.name}<br/>${p.percent}% · ${p.value.toFixed(2)} ms` },
      legend: { orient: 'vertical', right: 4, top: 'center', textStyle: { color: theme.sub, fontSize: 11 }, itemWidth: 11, itemHeight: 11 },
      series: [{
        type: 'pie', radius: ['52%', '78%'], center: ['34%', '50%'], avoidLabelOverlap: false,
        itemStyle: { borderColor: theme.bg, borderWidth: 2 },
        label: { show: false }, labelLine: { show: false },
        data: kernel.groups.map((gp) => ({ name: gp.label, value: gp.ms, itemStyle: { color: gp.color } })),
      }],
    };
    return mount(dom, opt);
  };

  // ---- kernel time-share bars (top positions) -----------------------------
  C.kernelBars = (dom, kernel, theme, topN = 8) => {
    const rows = kernel.positions.slice(0, topN).reverse();
    const opt = base(theme);
    opt.grid = { left: 130, right: 40, top: 8, bottom: 22 };
    opt.tooltip.formatter = (p) => `${p[0].name}<br/>${p[0].value.toFixed(2)} ms`;
    opt.xAxis = { type: 'value', axisLabel: { color: theme.sub, fontSize: 10 }, splitLine: { lineStyle: { color: theme.split, type: 'dashed' } }, axisLine: { show: false } };
    opt.yAxis = { type: 'category', data: rows.map((r) => r.name.split('.').pop()),
      axisLabel: { color: theme.sub, fontSize: 11 }, axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false } };
    opt.series = [{
      type: 'bar', barWidth: '62%', data: rows.map((r) => ({ value: r.ms, itemStyle: { color: window.Tree.colorOf(r.kind), borderRadius: [0, 3, 3, 0] } })),
    }];
    return mount(dom, opt);
  };

  window.Charts = C;
})();
