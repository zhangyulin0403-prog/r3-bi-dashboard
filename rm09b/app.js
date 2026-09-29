(() => {
  'use strict';

  const ALL = '全部';
  const ALL_DATES = '全部日期';
  const ALL_FEATURES = '全部功能';
  const ALL_NOTIFICATIONS = '全部通知';
  const app = document.getElementById('app');

  function hydrate(table) {
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return [];
    return table.rows.map(values => {
      const row = {};
      table.columns.forEach((column, index) => { row[column] = values[index]; });
      return row;
    });
  }

  const meta = window.RM09B_META;
  const data = {
    common: hydrate(window.RM09B_COMMON),
    feature: hydrate(window.RM09B_FEATURE),
    timing: hydrate(window.RM09B_TIMING),
    api: hydrate(window.RM09B_API),
  };

  if (!meta || Object.values(data).some(rows => !rows.length)) {
    app.innerHTML = '<div class="panel empty">数据文件缺失，请先运行 build_dashboard_data.py。</div>';
    document.getElementById('data-status').textContent = '数据不可用';
    return;
  }

  const commonMetricOptions = [
    ['新增用户数', '新增用户数'],
    ['D1留存率', 'D1留存率'],
    ['D3留存率', 'D3留存率'],
    ['play接口成功率_D0', 'Play 接口成功率 D0'],
    ['download接口成功率_D0', 'Download 接口成功率 D0'],
    ['卸载率_D0', '卸载率 D0'],
    ['首页到达率_D0', '首页到达率 D0'],
    ['通知授权率_D0', '通知授权率 D0'],
    ['通知展示率_D0', '通知展示率 D0'],
    ['通知点击率_D0', '通知点击率 D0'],
    ['人均展示次数_D0', '人均展示次数 D0'],
    ['人均点击次数_D0', '人均点击次数 D0'],
  ];
  const timingMetricOptions = [
    ['展示用户率', '展示用户率'],
    ['人均展示次数', '人均展示次数'],
    ['通知点击率', '通知点击率'],
    ['通知点击转化率', '通知点击转化率'],
    ['人均点击次数', '人均点击次数'],
  ];

  const state = {
    country: ALL,
    version: ALL,
    reportDate: meta.reportDate,
    date: ALL_DATES,
    day: 'D0',
    view: 'overview',
    overviewMetric: 'D1留存率',
    featureType: ALL_FEATURES,
    timingType: ALL_NOTIFICATIONS,
    timingMetric: '展示用户率',
    apiMetric: '功能可用性',
  };

  const editor = {
    enabled: false,
    selected: null,
    overrides: JSON.parse(localStorage.getItem('rm09b-editor-overrides') || '{}'),
  };

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  function parseNumber(raw, field = '') {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return { value: raw, kind: field === '新增用户数' ? 'count' : 'number' };
    const text = String(raw).trim().replaceAll(',', '');
    if (!text) return null;
    const numeric = Number.parseFloat(text.replace('%', ''));
    if (!Number.isFinite(numeric)) return null;
    if (text.includes('%')) {
      let value = numeric / 100;
      if ((field === 'D1留存率' || field === 'D3留存率') && value > 1) value /= 100;
      return { value, kind: 'percent' };
    }
    if (field.includes('成功率')) return { value: numeric / 100, kind: 'percent' };
    if (/^(通知栏播放器点击|常驻通知栏点击)_D[0-2]$/.test(field)) {
      return { value: numeric, kind: 'percent' };
    }
    if (field.includes('率')) return { value: numeric > 1 ? numeric / 100 : numeric, kind: 'percent' };
    return { value: numeric, kind: field === '新增用户数' ? 'count' : 'number' };
  }

  function weighted(rows, field) {
    if (field === '新增用户数') {
      return { value: rows.reduce((sum, row) => sum + (Number(row['新增用户数']) || 0), 0), kind: 'count' };
    }
    let weightedSum = 0;
    let totalWeight = 0;
    let kind = 'number';
    for (const row of rows) {
      const parsed = parseNumber(row[field], field);
      const weight = Number(row['新增用户数']) || 0;
      if (!parsed || weight <= 0) continue;
      weightedSum += parsed.value * weight;
      totalWeight += weight;
      kind = parsed.kind;
    }
    return totalWeight > 0 ? { value: weightedSum / totalWeight, kind } : { value: null, kind };
  }

  function formatMetric(metric, digits = 2) {
    if (!metric || metric.value === null || !Number.isFinite(metric.value)) return '—';
    if (metric.kind === 'percent') return `${(metric.value * 100).toFixed(digits)}%`;
    if (metric.kind === 'count') return Math.round(metric.value).toLocaleString('zh-CN');
    const absolute = Math.abs(metric.value);
    const precision = absolute >= 100 ? 1 : absolute >= 10 ? 2 : 3;
    return metric.value.toLocaleString('zh-CN', { maximumFractionDigits: precision });
  }

  function dateLabel(iso) {
    if (!iso) return '';
    const [year, month, day] = iso.split('-');
    return `${Number(month)}/${Number(day)}`;
  }

  function exactFilter(rows, overrides = {}) {
    const country = overrides.country ?? state.country;
    const version = overrides.version ?? state.version;
    const reportDate = overrides.reportDate ?? state.reportDate;
    const date = overrides.date ?? state.date;
    return rows.filter(row =>
      row['国家'] === country && row['版本'] === version &&
      row['报表日期'] === reportDate &&
      (date === ALL_DATES || row['首次访问日期'] === date)
    );
  }

  function groupRows(rows, key) {
    const grouped = new Map();
    for (const row of rows) {
      const value = row[key];
      if (!grouped.has(value)) grouped.set(value, []);
      grouped.get(value).push(row);
    }
    return grouped;
  }

  function selectOptions(values, selected, labels = {}) {
    return values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(labels[value] || value)}</option>`).join('');
  }

  function metricSelect(id, options, selected) {
    return `<select class="metric-select" id="${id}">${options.map(([value, label]) =>
      `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`
    ).join('')}</select>`;
  }

  function editorPath(element) {
    const parts = [];
    let node = element;
    while (node && node !== document.body) {
      let index = 1;
      let sibling = node;
      while ((sibling = sibling.previousElementSibling)) index += 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function editorKey(element) {
    const root = element.closest('#app') ? 'app' : 'page';
    return `${state.view}|${root}|${editorPath(element)}`;
  }

  function textEditable(element) {
    return element.matches('h1,h2,h3,p,.eyebrow,.kpi .label,.kpi .value,.kpi .note,.bar-label,.bar-value,.section-head p,.subtitle,.tabs button,.topbar p,.status-chip,footer span,button');
  }

  function editorTargetLabel(element) {
    const text = (element.innerText || element.getAttribute('aria-label') || element.tagName).trim().replace(/\s+/g, ' ');
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

  function tagEditorNodes() {
    const selectors = 'h1,h2,h3,p,.eyebrow,.kpi,.kpi .label,.kpi .value,.kpi .note,.panel,.bar-row,.bar-label,.bar-value,.section-head,.tabs button,.filters,.topbar,.status-chip,footer span,.line-chart,.bar-fill';
    document.querySelectorAll(selectors).forEach(element => {
      element.classList.add('editor-targetable');
      element.dataset.editorKey = editorKey(element);
    });
  }

  function persistEditor() {
    localStorage.setItem('rm09b-editor-overrides', JSON.stringify(editor.overrides));
  }

  function clearEditorForm() {
    document.getElementById('editor-target-name').textContent = '尚未选择';
    document.getElementById('editor-target-path').textContent = '—';
    document.getElementById('editor-text').value = '';
    document.getElementById('editor-text').disabled = true;
    document.getElementById('editor-color').disabled = true;
    document.getElementById('editor-background').disabled = true;
    document.getElementById('editor-hidden').disabled = true;
    document.getElementById('apply-editor').disabled = true;
    document.getElementById('reset-editor').disabled = true;
  }

  function applyEditorOverrides() {
    tagEditorNodes();
    document.querySelectorAll('[data-editor-key]').forEach(element => {
      const override = editor.overrides[element.dataset.editorKey];
      element.classList.toggle('editor-hidden', Boolean(override?.hidden));
      if (override?.color) element.style.color = override.color;
      if (override?.background) element.style.backgroundColor = override.background;
      if (override?.text && textEditable(element)) element.textContent = override.text;
    });
    if (editor.selected && !document.body.contains(editor.selected)) {
      editor.selected = null;
      clearEditorForm();
    }
  }

  function selectEditorTarget(element) {
    if (editor.selected) editor.selected.classList.remove('editor-selected');
    editor.selected = element;
    element.classList.add('editor-selected');
    const key = element.dataset.editorKey || editorKey(element);
    const override = editor.overrides[key] || {};
    const editable = textEditable(element);
    document.getElementById('editor-target-name').textContent = editorTargetLabel(element);
    document.getElementById('editor-target-path').textContent = key;
    document.getElementById('editor-text').value = override.text ?? (editable ? element.innerText.trim() : '');
    document.getElementById('editor-text').disabled = !editable;
    document.getElementById('editor-color').disabled = false;
    document.getElementById('editor-background').disabled = false;
    document.getElementById('editor-hidden').disabled = false;
    document.getElementById('editor-hidden').checked = Boolean(override.hidden);
    document.getElementById('editor-color').value = override.color || '#152536';
    document.getElementById('editor-background').value = override.background || '#ffffff';
    document.getElementById('apply-editor').disabled = false;
    document.getElementById('reset-editor').disabled = false;
    document.getElementById('editor-status').textContent = editable ? '这个元素支持文字、颜色和显示状态修改。' : '这是容器元素；可修改颜色和显示状态，请点击具体文字编辑内容。';
  }

  function setEditorEnabled(enabled) {
    editor.enabled = enabled;
    document.body.classList.toggle('editor-mode', enabled);
    document.getElementById('toggle-editor').classList.toggle('active', enabled);
    document.getElementById('toggle-editor').setAttribute('aria-pressed', String(enabled));
    document.getElementById('toggle-editor').textContent = enabled ? '退出编辑模式' : '进入编辑模式';
    document.getElementById('editor-panel').classList.toggle('open', enabled);
    document.getElementById('editor-panel').setAttribute('aria-hidden', String(!enabled));
    if (!enabled && editor.selected) editor.selected.classList.remove('editor-selected');
    if (!enabled) { editor.selected = null; clearEditorForm(); }
  }

  function initializeEditor() {
    const panel = document.getElementById('editor-panel');
    document.getElementById('toggle-editor').addEventListener('click', () => setEditorEnabled(!editor.enabled));
    document.getElementById('close-editor').addEventListener('click', () => setEditorEnabled(false));
    document.addEventListener('click', event => {
      if (!editor.enabled || event.target.closest('#editor-panel') || event.target.closest('#toggle-editor')) return;
      const target = event.target.closest('.editor-targetable');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectEditorTarget(target);
    }, true);
    document.getElementById('apply-editor').addEventListener('click', () => {
      if (!editor.selected) return;
      const key = editor.selected.dataset.editorKey;
      editor.overrides[key] = {
        text: textEditable(editor.selected) ? document.getElementById('editor-text').value : '',
        color: document.getElementById('editor-color').value,
        background: document.getElementById('editor-background').value,
        hidden: document.getElementById('editor-hidden').checked,
      };
      persistEditor();
      applyEditorOverrides();
      const selectedAgain = [...document.querySelectorAll('[data-editor-key]')].find(element => element.dataset.editorKey === key);
      if (selectedAgain) selectEditorTarget(selectedAgain);
      document.getElementById('editor-status').textContent = '已应用并保存到当前浏览器。';
    });
    document.getElementById('reset-editor').addEventListener('click', () => {
      if (!editor.selected) return;
      const key = editor.selected.dataset.editorKey;
      delete editor.overrides[key];
      persistEditor();
      applyEditorOverrides();
      const selectedAgain = [...document.querySelectorAll('[data-editor-key]')].find(element => element.dataset.editorKey === key);
      if (selectedAgain) selectEditorTarget(selectedAgain);
      document.getElementById('editor-status').textContent = '已清除当前元素修改。';
    });
    document.getElementById('reset-all-editor').addEventListener('click', () => {
      editor.overrides = {};
      persistEditor();
      applyEditorOverrides();
      if (editor.selected) selectEditorTarget(editor.selected);
      document.getElementById('editor-status').textContent = '已清除全部本地修改。';
    });
    panel.addEventListener('click', event => event.stopPropagation());
    clearEditorForm();
  }

  function barList(items, limit = 12) {
    const usable = items.filter(item => item.metric?.value !== null).slice(0, limit);
    if (!usable.length) return '<div class="empty">当前筛选条件没有可展示的数据。</div>';
    const max = Math.max(...usable.map(item => Math.abs(item.metric.value)), 0.000001);
    return `<div class="bar-list">${usable.map(item => `
      <div class="bar-row" title="${esc(item.label)}">
        <div class="bar-label">${esc(item.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, Math.abs(item.metric.value) / max * 100).toFixed(2)}%"></div></div>
        <div class="bar-value">${formatMetric(item.metric)}</div>
      </div>`).join('')}</div>`;
  }

  function lineChart(points) {
    const usable = points.filter(point => point.metric?.value !== null && Number.isFinite(point.metric.value));
    if (!usable.length) return '<div class="empty">当前筛选条件没有趋势数据。</div>';
    const width = 860, height = 290, left = 62, right = 24, top = 22, bottom = 52;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const values = usable.map(point => point.metric.value);
    const maxValue = Math.max(...values, 0);
    const upper = maxValue > 0 ? maxValue * 1.18 : 1;
    const x = index => left + (usable.length === 1 ? plotWidth / 2 : index * plotWidth / (usable.length - 1));
    const y = value => top + plotHeight - (value / upper) * plotHeight;
    const coordinates = usable.map((point, index) => `${x(index).toFixed(1)},${y(point.metric.value).toFixed(1)}`);
    const area = `${left},${top + plotHeight} ${coordinates.join(' ')} ${x(usable.length - 1)},${top + plotHeight}`;
    const grid = [0, .25, .5, .75, 1].map(ratio => {
      const value = upper * (1 - ratio);
      const metric = { value, kind: usable[0].metric.kind };
      const yy = top + ratio * plotHeight;
      return `<line class="grid-line" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}"></line>
        <text class="axis-label" x="${left - 10}" y="${yy + 4}" text-anchor="end">${esc(formatMetric(metric, 1))}</text>`;
    }).join('');
    const dots = usable.map((point, index) => `
      <circle class="trend-dot" cx="${x(index)}" cy="${y(point.metric.value)}" r="5"></circle>
      <text class="axis-label" x="${x(index)}" y="${height - 22}" text-anchor="middle">${esc(dateLabel(point.label))}</text>
      <text class="axis-label" x="${x(index)}" y="${Math.max(15, y(point.metric.value) - 11)}" text-anchor="middle">${esc(formatMetric(point.metric, 1))}</text>`).join('');
    return `<div class="line-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="指标趋势图">
      <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3567d6" stop-opacity=".22"></stop><stop offset="1" stop-color="#3567d6" stop-opacity="0"></stop></linearGradient></defs>
      ${grid}<polygon class="trend-area" points="${area}"></polygon><polyline class="trend-line" points="${coordinates.join(' ')}"></polyline>${dots}
    </svg></div>`;
  }

  function genericObjectMetrics(rows, valueField) {
    const grouped = groupRows(rows, '分析对象');
    return [...grouped.entries()].map(([label, group]) => ({ label, metric: weighted(group, valueField), rows: group.length }))
      .sort((a, b) => (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));
  }

  function typedObjectMetrics(rows, valueField, includeType) {
    const grouped = new Map();
    for (const row of rows) {
      const type = row['分析类型'];
      const object = row['分析对象'];
      const key = includeType ? `${type}\u0000${object}` : object;
      if (!grouped.has(key)) grouped.set(key, { type, object, rows: [] });
      grouped.get(key).rows.push(row);
    }
    return [...grouped.values()].map(item => ({
      label: includeType ? `${item.type}｜${item.object}` : item.object,
      type: item.type,
      object: item.object,
      metric: weighted(item.rows, valueField),
      rows: item.rows.length,
    })).sort((a, b) => (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));
  }

  function summedMetric(rows, field) {
    const value = rows.reduce((sum, row) => sum + (Number.parseFloat(String(row[field] || '0').replaceAll(',', '')) || 0), 0);
    return { value, kind: 'count' };
  }

  function apiRateMetric(rows, metric) {
    if (metric === '功能可用性') {
      const success = rows.reduce((sum, row) => sum + (Number(row['成功事件数']) || 0), 0);
      return { value: success > 0 ? 1 : 0, kind: 'percent' };
    }
    const fields = {
      '用户成功率': ['成功用户数', '请求用户数'],
      '事件成功率': ['成功事件数', '请求事件数'],
      '用户失败率': ['失败用户数', '请求用户数'],
      '事件失败率': ['失败事件数', '请求事件数'],
    }[metric];
    if (!fields) return { value: null, kind: 'percent' };
    const numerator = rows.reduce((sum, row) => sum + (Number(row[fields[0]]) || 0), 0);
    const denominator = rows.reduce((sum, row) => sum + (Number(row[fields[1]]) || 0), 0);
    return { value: denominator > 0 ? numerator / denominator : null, kind: 'percent' };
  }

  function apiAvailabilitySummary(rows) {
    const groups = groupRows(rows, 'api');
    let eligible = 0;
    let available = 0;
    for (const group of groups.values()) {
      const requests = group.reduce((sum, row) => sum + (Number(row['请求事件数']) || 0), 0);
      const success = group.reduce((sum, row) => sum + (Number(row['成功事件数']) || 0), 0);
      if (requests > 0 || success > 0) {
        eligible += 1;
        if (success > 0) available += 1;
      }
    }
    return {
      rate: { value: eligible > 0 ? available / eligible : null, kind: 'percent' },
      available: { value: available, kind: 'count' },
      eligible,
    };
  }

  function renderOverview() {
    const rows = exactFilter(data.common);
    const day = state.day;
    const coreApiRows = exactFilter(data.api).filter(row => row['api'] && row['type'] === 'ALL');
    const hasStructuredApi = coreApiRows.length > 0;
    const apiAvailability = hasStructuredApi ? apiAvailabilitySummary(coreApiRows) : null;
    const kpis = [
      ['新增用户数', weighted(rows, '新增用户数'), '所选首访日期合计'],
      ['D1留存率', weighted(rows, 'D1留存率'), '按新增用户数加权'],
      ['D3留存率', weighted(rows, 'D3留存率'), '较新首访日可能尚未成熟'],
      [hasStructuredApi ? '核心 API 可用率' : `Play 接口成功率 ${day}`, hasStructuredApi ? apiAvailability.rate : weighted(rows, `play接口成功率_${day}`), hasStructuredApi ? '存在成功事件即视为可用' : '历史报表源字段'],
      [hasStructuredApi ? '可用核心 API 数' : `首页到达率 ${day}`, hasStructuredApi ? apiAvailability.available : weighted(rows, `首页到达率_${day}`), hasStructuredApi ? `共 ${apiAvailability.eligible} 个有请求或成功记录` : '历史报表源字段'],
      [`卸载率 ${day}`, weighted(rows, `卸载率_${day}`), '越低越好'],
    ];

    const trendRows = exactFilter(data.common, { reportDate: state.reportDate, date: ALL_DATES });
    const trend = [...groupRows(trendRows, '首次访问日期').entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, group]) => ({ label, metric: weighted(group, state.overviewMetric) }));

    const countryRows = data.common.filter(row => row['国家'] !== ALL && row['版本'] === state.version && row['报表日期'] === state.reportDate && (state.date === ALL_DATES || row['首次访问日期'] === state.date));
    const countryItems = [...groupRows(countryRows, '国家').entries()].map(([label, group]) => ({ label, metric: weighted(group, state.overviewMetric) }))
      .sort((a, b) => (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));
    const versionRows = data.common.filter(row => row['国家'] === state.country && row['版本'] !== ALL && row['报表日期'] === state.reportDate && (state.date === ALL_DATES || row['首次访问日期'] === state.date));
    const versionItems = [...groupRows(versionRows, '版本').entries()].map(([label, group]) => ({ label, metric: weighted(group, state.overviewMetric) }))
      .sort((a, b) => (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));

    app.innerHTML = `
      <section class="kpi-grid">${kpis.map(([label, metric, note]) => `<article class="kpi"><div class="label">${esc(label)}</div><div class="value">${formatMetric(metric)}</div><div class="note">${esc(note)}</div></article>`).join('')}</section>
      <section class="grid-2">
        <article class="panel">
          <div class="section-head"><div><h3>首访 cohort 趋势</h3><p>${esc(state.country)} · ${esc(state.version)}</p></div><div class="section-controls">${metricSelect('overview-metric', commonMetricOptions, state.overviewMetric)}</div></div>
          ${lineChart(trend)}
        </article>
        <article class="panel"><h3>国家对比</h3><div class="subtitle">版本：${esc(state.version)}；指标：${esc(commonMetricOptions.find(item => item[0] === state.overviewMetric)?.[1] || state.overviewMetric)}</div>${barList(countryItems, 10)}</article>
      </section>
      <section class="grid-even">
        <article class="panel"><h3>版本对比</h3><div class="subtitle">国家：${esc(state.country)}；不含“全部”汇总项</div>${barList(versionItems, 10)}</article>
        <article class="panel"><h3>当前口径</h3><div class="subtitle">所有模块都使用同一组筛选条件</div>
          <div class="source-list">
            <div class="source-item"><span>国家</span><strong>${esc(state.country)}</strong><span class="good">精确匹配</span></div>
            <div class="source-item"><span>版本</span><strong>${esc(state.version)}</strong><span class="good">精确匹配</span></div>
            <div class="source-item"><span>报表日期</span><strong>${esc(state.reportDate)}</strong><span>单期报表快照</span></div>
            <div class="source-item"><span>首访日期</span><strong>${esc(state.date)}</strong><span>${state.date === ALL_DATES ? '跨日期加权' : '单日 cohort'}</span></div>
            <div class="source-item"><span>周期</span><strong>${esc(state.day)}</strong><span>不跨周期混算</span></div>
          </div>
        </article>
      </section>`;
    document.getElementById('overview-metric').addEventListener('change', event => { state.overviewMetric = event.target.value; render(); });
  }

  function unsupportedDay(title) {
    app.innerHTML = `<article class="panel empty"><div><h2>${esc(title)}不提供 ${esc(state.day)}</h2><p>该源表仅包含 D0 和 D1。请把“指标周期”切换为 D0 或 D1。</p></div></article>`;
  }

  function renderFeature() {
    if (state.day === 'D2') return unsupportedDay('功能分析');
    const detailTypes = [...new Set(data.feature.map(row => row['分析类型']))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const types = [ALL_FEATURES, ...detailTypes];
    if (!types.includes(state.featureType)) state.featureType = ALL_FEATURES;
    const showAll = state.featureType === ALL_FEATURES;
    const filtered = exactFilter(data.feature);
    const rows = showAll ? filtered : filtered.filter(row => row['分析类型'] === state.featureType);
    const items = typedObjectMetrics(rows, state.day, showAll);
    app.innerHTML = `
        <div class="section-head"><div><h2>功能行为分析</h2><p>辅助行为数据；核心功能可用性以 API 成功为准</p></div><div class="section-controls">${metricSelect('feature-type', types.map(value => [value, value]), state.featureType)}</div></div>
      <section class="grid-2">
        <article class="panel"><h3>${esc(state.featureType)}平铺对比</h3><div class="subtitle">${showAll ? `覆盖 ${detailTypes.length} 个功能类型` : '当前功能类型'}，共 ${items.length} 个分析对象</div>${barList(items, showAll ? items.length : 15)}</article>
        <article class="panel"><h3>分析对象明细</h3><div class="subtitle">当前筛选范围内的加权结果</div>
          <div class="table-wrap"><table><thead><tr>${showAll ? '<th>功能类型</th>' : ''}<th>分析对象</th><th class="num">${esc(state.day)}</th><th class="num">源行数</th></tr></thead><tbody>
          ${items.map(item => `<tr>${showAll ? `<td>${esc(item.type)}</td>` : ''}<td>${esc(item.object)}</td><td class="num">${formatMetric(item.metric)}</td><td class="num">${item.rows}</td></tr>`).join('') || `<tr><td colspan="${showAll ? 4 : 3}">无数据</td></tr>`}
          </tbody></table></div>
        </article>
      </section>`;
    document.getElementById('feature-type').addEventListener('change', event => { state.featureType = event.target.value; render(); });
  }

  function renderTiming() {
    const detailTypes = [...new Set(data.timing.map(row => row['分析类型']))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const types = [ALL_NOTIFICATIONS, ...detailTypes];
    if (!types.includes(state.timingType)) state.timingType = ALL_NOTIFICATIONS;
    const showAll = state.timingType === ALL_NOTIFICATIONS;
    const field = `${state.day}${state.timingMetric}`;
    const filtered = exactFilter(data.timing);
    const rows = showAll ? filtered : filtered.filter(row => row['分析类型'] === state.timingType);
    const items = typedObjectMetrics(rows, field, showAll);
    app.innerHTML = `
      <div class="section-head"><div><h2>通知分析</h2><p>默认平铺所有通知，也可按通知时机或通知文案单独查看</p></div><div class="section-controls">${metricSelect('timing-type', types.map(value => [value, value]), state.timingType)}${metricSelect('timing-metric', timingMetricOptions, state.timingMetric)}</div></div>
      <section class="grid-2">
        <article class="panel"><h3>${esc(state.timingType)} · ${esc(state.day)}${esc(state.timingMetric)}</h3><div class="subtitle">${showAll ? `覆盖 ${detailTypes.length} 个通知类型` : '当前通知类型'}；按新增用户数加权</div>${barList(items, showAll ? items.length : 18)}</article>
        <article class="panel"><h3>通知对象明细</h3><div class="subtitle">共 ${items.length} 个对象</div>
          <div class="table-wrap"><table><thead><tr>${showAll ? '<th>通知类型</th>' : ''}<th>分析对象</th><th class="num">${esc(state.day)}${esc(state.timingMetric)}</th><th class="num">源行数</th></tr></thead><tbody>
          ${items.map(item => `<tr>${showAll ? `<td>${esc(item.type)}</td>` : ''}<td>${esc(item.object)}</td><td class="num">${formatMetric(item.metric)}</td><td class="num">${item.rows}</td></tr>`).join('') || `<tr><td colspan="${showAll ? 4 : 3}">无数据</td></tr>`}
          </tbody></table></div>
        </article>
      </section>`;
    document.getElementById('timing-type').addEventListener('change', event => { state.timingType = event.target.value; render(); });
    document.getElementById('timing-metric').addEventListener('change', event => { state.timingMetric = event.target.value; render(); });
  }

  function renderApi() {
    const rows = exactFilter(data.api);
    const newApiRows = rows.filter(row => row['api'] && row['type'] === 'ALL');
    if (newApiRows.length) {
      const apiGroups = groupRows(newApiRows, 'api');
      const apiItems = [...apiGroups.entries()].map(([label, group]) => ({ label, metric: apiRateMetric(group, state.apiMetric), rows: group.length }))
        .sort((a, b) => state.apiMetric === '功能可用性'
          ? (a.metric.value ?? Infinity) - (b.metric.value ?? Infinity)
          : (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));
      const requestItems = apiItems.map(item => ({ ...item, metric: summedMetric(apiGroups.get(item.label), '请求事件数') }))
        .sort((a, b) => (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));
      const failureField = state.apiMetric === '用户成功率' ? '用户失败率' : '事件失败率';
      const failureItems = apiItems.map(item => ({ ...item, metric: apiRateMetric(apiGroups.get(item.label), failureField) }))
        .sort((a, b) => (b.metric.value ?? -Infinity) - (a.metric.value ?? -Infinity));
      const unavailable = apiItems.filter(item => item.metric.value === 0).map(item => item.label);
      app.innerHTML = `
        <div class="section-head"><div><h2>核心功能</h2><p>成功事件数大于 0 即判定功能可正常使用；新 API 表不受 D0/D1/D2 选择影响</p></div><div class="section-controls">${metricSelect('api-metric', [['功能可用性', '功能可用性'], ['事件成功率', '成功事件率'], ['用户成功率', '成功用户率']], state.apiMetric)}</div></div>
        ${state.apiMetric === '功能可用性' && unavailable.length ? `<div class="api-alert"><strong>未检测到成功事件：</strong>${unavailable.map(esc).join('、')}</div>` : ''}
        <section class="grid-even">
          <article class="panel"><h3>${state.apiMetric === '功能可用性' ? '功能 API 可用状态' : '功能 API 成功率'}</h3><div class="subtitle">${state.apiMetric === '功能可用性' ? '未检测到成功事件的 API 优先展示' : `按成功数÷请求数重算；${esc(state.apiMetric)} 越高越好`}</div>${barList(apiItems, state.apiMetric === '功能可用性' ? 50 : 25)}</article>
          <article class="panel"><h3>API 请求事件数</h3><div class="subtitle">所选 cohort 的请求事件数合计</div>${barList(requestItems, 25)}</article>
        </section>
        <section class="panel" style="margin-top:14px"><h3>功能 API 失败率</h3><div class="subtitle">${esc(failureField)} 越低越好</div>${barList(failureItems, 25)}</section>`;
      document.getElementById('api-metric').addEventListener('change', event => { state.apiMetric = event.target.value; render(); });
      return;
    }
    if (state.day === 'D2') return unsupportedDay('API 分析');
    const items = genericObjectMetrics(rows, state.day);
    const success = items.filter(item => item.label.includes('成功率'));
    const request = items.filter(item => item.label.includes('请求率'));
    const failure = items.filter(item => item.label.includes('失败率'));
    app.innerHTML = `
      <div class="section-head"><div><h2>API 分析</h2><p>RM 专属接口请求、成功与失败指标</p></div></div>
      <section class="grid-even">
        <article class="panel"><h3>接口成功率</h3><div class="subtitle">${esc(state.day)} · 按新增用户数加权</div>${barList(success, 20)}</article>
        <article class="panel"><h3>接口请求率</h3><div class="subtitle">${esc(state.day)} · 按新增用户数加权</div>${barList(request, 20)}</article>
      </section>
      <section class="panel" style="margin-top:14px"><h3>接口失败率</h3><div class="subtitle">失败率越低越好</div>${barList(failure, 20)}</section>`;
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
    if (state.view === 'overview') renderOverview();
    else if (state.view === 'feature') renderFeature();
    else if (state.view === 'timing') renderTiming();
    else renderApi();
    applyEditorOverrides();
  }

  function initializeFilters() {
    const countries = [...new Set(data.common.map(row => row['国家']))];
    const countryWeights = new Map();
    for (const row of data.common.filter(row => row['国家'] !== ALL && row['版本'] === ALL)) {
      countryWeights.set(row['国家'], (countryWeights.get(row['国家']) || 0) + (Number(row['新增用户数']) || 0));
    }
    countries.sort((a, b) => a === ALL ? -1 : b === ALL ? 1 : (countryWeights.get(b) || 0) - (countryWeights.get(a) || 0));

    const versions = [...new Set(data.common.map(row => row['版本']))];
    const versionKey = value => value.split('.').map(Number);
    versions.sort((a, b) => {
      if (a === ALL) return -1;
      if (b === ALL) return 1;
      const av = versionKey(a), bv = versionKey(b);
      for (let index = 0; index < Math.max(av.length, bv.length); index++) {
        const diff = (bv[index] || 0) - (av[index] || 0);
        if (diff) return diff;
      }
      return 0;
    });
    const reportDates = [...new Set(data.common.map(row => row['报表日期']))].sort().reverse();
    const reportDateLabels = Object.fromEntries(reportDates.map(value => [value, `${value}（报表）`]));

    const country = document.getElementById('filter-country');
    const version = document.getElementById('filter-version');
    const reportDate = document.getElementById('filter-report-date');
    const date = document.getElementById('filter-date');
    const day = document.getElementById('filter-day');
    const refreshFirstDates = () => {
      const dates = [ALL_DATES, ...[...new Set(data.common.filter(row => row['报表日期'] === state.reportDate).map(row => row['首次访问日期']))].sort().reverse()];
      if (!dates.includes(state.date)) state.date = ALL_DATES;
      const dateLabels = Object.fromEntries(dates.map(value => [value, value === ALL_DATES ? value : `${value}（首访）`]));
      date.innerHTML = selectOptions(dates, state.date, dateLabels);
    };
    country.innerHTML = selectOptions(countries, state.country);
    version.innerHTML = selectOptions(versions, state.version);
    reportDate.innerHTML = selectOptions(reportDates, state.reportDate, reportDateLabels);
    refreshFirstDates();
    day.value = state.day;

    country.addEventListener('change', event => { state.country = event.target.value; render(); });
    version.addEventListener('change', event => { state.version = event.target.value; render(); });
    reportDate.addEventListener('change', event => { state.reportDate = event.target.value; refreshFirstDates(); render(); });
    date.addEventListener('change', event => { state.date = event.target.value; render(); });
    day.addEventListener('change', event => { state.day = event.target.value; render(); });
    document.getElementById('reset-filters').addEventListener('click', () => {
      state.country = ALL; state.version = ALL; state.reportDate = meta.reportDate; state.date = ALL_DATES; state.day = 'D0';
      country.value = state.country; version.value = state.version; reportDate.value = state.reportDate; date.value = state.date; day.value = state.day;
      render();
    });
  }

  document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    render();
  }));

  document.getElementById('report-caption').textContent = `项目 ${meta.project} · 报表范围 ${meta.reportDates?.length || 1} 期 · 最新 ${meta.reportDate} · ${Number(meta.totalRows).toLocaleString('zh-CN')} 行源数据`;
  document.getElementById('data-status').textContent = '数据校验通过';
  initializeEditor();
  initializeFilters();
  render();
})();
