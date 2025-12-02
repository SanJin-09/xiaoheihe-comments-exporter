// For extension messaging
let autoLoaded = false;

const fileInput = document.getElementById("csv-file");
const fileNameEl = document.getElementById("file-name");
const statsEl = document.getElementById("stats") || null;
const topUsersEl = document.getElementById("top-users") || null;
const topLikesEl = document.getElementById("top-likes") || null;
const wordCloudCanvas = document.getElementById("word-cloud-canvas");
const wordCloudTooltip = document.getElementById("word-cloud-tooltip");

const chartEls = {
  wordCloud: wordCloudCanvas,
  region: document.getElementById("region-canvas"),
  regionLegend: document.getElementById("region-legend"),
  regionTooltip: document.getElementById("region-tooltip"),
};

const WORD_CLOUD_BASE = { width: 800, height: 520 };
const WORD_CLOUD_CFG = {
  minSize: 16,
  maxSize: 60,
  maxWords: 200,
  spiralStep: 6,
  spiralAngleStep: 0.35,
  maxAttempts: 900,
  minSizeFallback: 12,
  ellipseX: 1.2,
  ellipseY: 0.9,
};
const WORD_CLOUD_FONTS = ["'Inter'", "'Work Sans'", "'DM Sans'", "'Playfair Display'", "'Montserrat'"];
const WORD_CLOUD_ANGLES = [0]; // No rotation for ultra-minimalist look
const wordCloudState = {
  placements: [],
  selected: null,
};

const REGION_BASE = { width: 900, height: 560 };
const REGION_CFG = {
  maxRegions: 24,
  minLength: 80,
  maxLength: 240,
  petalWidth: 28,
  minGray: 235,
  maxGray: 30,
};
const regionState = {
  petals: [],
  selected: null,
  maxValue: 0,
};

const stopWords = new Set(["的","了","啊","吗","呢","哦","吧","啊啊","哈","哈哈","和","在","是","就","都","也","我","你","他","她","它","这","那","一个","还有","还是","或者","以及","所以"]);

const escapeHtml = (str = "") => str
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const setFileName = (name) => {
  if (fileNameEl) {
    fileNameEl.textContent = name || "未选择文件";
  }
};

const cleanText = (txt = "") => {
  return txt
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase();
};

const splitWords = (content) => {
  const cleaned = cleanText(content);
  return cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !stopWords.has(w));
};

const updateStats = (rows) => {
  if (!statsEl) return;
  if (!rows.length) {
    statsEl.innerHTML = `<div class="stat-card">暂无数据</div>`;
    return;
  }
  const total = rows.length;
  const withLikes = rows.filter((r) => r.likes > 0).length;
  const uniqueUsers = new Set(rows.map((r) => r.user).filter(Boolean)).size;
  const uniqueIPs = new Set(rows.map((r) => r.ip).filter(Boolean)).size;
  const items = [
    { label: "总评论数", value: total },
    { label: "有点赞", value: withLikes },
    { label: "用户数", value: uniqueUsers },
    { label: "IP/地域数", value: uniqueIPs },
  ];
  statsEl.innerHTML = items.map(
    (item) => `<div class="stat-card"><div>${escapeHtml(String(item.value))}</div><span>${item.label}</span></div>`
  ).join("");
};

const renderBars = (el, data, { valueLabel = "条" } = {}) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  el.innerHTML = data.map((d) => {
    const pct = (d.value / max) * 100;
    return `
      <div style="margin:6px 0;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#cbd5e1;margin-bottom:4px;">
          <span>${d.name}</span><span>${d.value} ${valueLabel}</span>
        </div>
        <div style="background:rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;">
          <div style="height:12px;width:${pct}%;background:linear-gradient(135deg,#22c55e,#2563eb);"></div>
        </div>
      </div>
    `;
  }).join("");
};

const renderTopUsers = (rows) => {
  if (!topUsersEl) return;
  const counts = {};
  rows.forEach((r) => {
    if (!r.user) return;
    counts[r.user] = (counts[r.user] || 0) + 1;
  });
  const data = Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  if (!data.length) {
    topUsersEl.innerHTML = `<div class="list-item">暂无用户数据</div>`;
    return;
  }
  topUsersEl.innerHTML = data.map((d, idx) => {
    return `<div class="list-item">
      <div class="meta"><span>${idx + 1}. ${escapeHtml(d.name)}</span><span>${d.value} 条</span></div>
    </div>`;
  }).join("");
};

const renderTopLikes = (rows) => {
  if (!topLikesEl) return;
  const top = rows
    .filter((r) => r.likes > 0 && r.content)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 10);
  if (!top.length) {
    topLikesEl.innerHTML = `<div class="list-item">暂无点赞数据</div>`;
    return;
  }
  topLikesEl.innerHTML = top.map((r, idx) => {
    const content = escapeHtml(r.content.length > 120 ? `${r.content.slice(0, 120)}...` : r.content);
    const user = escapeHtml(r.user || "未知用户");
    return `<div class="list-item">
      <div class="meta"><span>${idx + 1}. ${user}</span><span>${r.likes} 赞</span></div>
      <div class="content">${content}</div>
    </div>`;
  }).join("");
};

const setWordCloudMessage = (text) => {
  if (!wordCloudCanvas) return;
  const ctx = wordCloudCanvas.getContext("2d");
  wordCloudCanvas.width = WORD_CLOUD_BASE.width;
  wordCloudCanvas.height = WORD_CLOUD_BASE.height;
  ctx.clearRect(0, 0, WORD_CLOUD_BASE.width, WORD_CLOUD_BASE.height);
  ctx.save();
  ctx.fillStyle = "#b0b0b0";
  ctx.font = "16px 'Inter', 'Montserrat', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text || "暂无数据", WORD_CLOUD_BASE.width / 2, WORD_CLOUD_BASE.height / 2);
  ctx.restore();
  if (wordCloudTooltip) wordCloudTooltip.style.opacity = 0;
};

const mapFontSize = (value, minV, maxV) => {
  const minSize = WORD_CLOUD_CFG.minSize;
  const maxSize = WORD_CLOUD_CFG.maxSize;
  if (maxV === minV) return maxSize;
  const minWeight = Math.log(minV + 1);
  const maxWeight = Math.log(maxV + 1);
  const weight = Math.log(value + 1);
  const t = (weight - minWeight) / Math.max(1e-6, maxWeight - minWeight);
  return minSize + t * (maxSize - minSize);
};

const measureWord = (ctx, text, fontSize, fontWeight = 500, fontFamily = "'Inter'") => {
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
  const metrics = ctx.measureText(text);
  const width = metrics.width;
  const height = fontSize * 1.1;
  return { width, height };
};

const makeBBox = (x, y, width, height, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const bw = Math.abs(width * cos) + Math.abs(height * sin);
  const bh = Math.abs(width * sin) + Math.abs(height * cos);
  return {
    x1: x - bw / 2,
    y1: y - bh / 2,
    x2: x + bw / 2,
    y2: y + bh / 2,
  };
};

const bboxesOverlap = (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);

const placeWord = (ctx, word, fontSize, placements, fontWeight, fontFamily) => {
  const center = { x: WORD_CLOUD_BASE.width / 2, y: WORD_CLOUD_BASE.height / 2 };
  let size = fontSize;
  for (let attempt = 0; attempt < WORD_CLOUD_CFG.maxAttempts; attempt += 1) {
    if (attempt && attempt % 180 === 0 && size > WORD_CLOUD_CFG.minSizeFallback) {
      size = Math.max(WORD_CLOUD_CFG.minSizeFallback, size - 2);
    }
    const spiralAngle = attempt * WORD_CLOUD_CFG.spiralAngleStep;
    const radius = WORD_CLOUD_CFG.spiralStep * spiralAngle;
    const x = center.x + radius * Math.cos(spiralAngle) * WORD_CLOUD_CFG.ellipseX;
    const y = center.y + radius * Math.sin(spiralAngle) * WORD_CLOUD_CFG.ellipseY;
    const angle = WORD_CLOUD_ANGLES[0];
    const { width, height } = measureWord(ctx, word, size, fontWeight, fontFamily);
    const bbox = makeBBox(x, y, width, height, angle);
    const outOfBounds = bbox.x1 < 0 || bbox.x2 > WORD_CLOUD_BASE.width || bbox.y1 < 0 || bbox.y2 > WORD_CLOUD_BASE.height;
    if (outOfBounds) {
      if (attempt % 120 === 119 && size > WORD_CLOUD_CFG.minSizeFallback) {
        size = Math.max(WORD_CLOUD_CFG.minSizeFallback, size - 2);
      }
      continue;
    }
    const collides = placements.some((p) => bboxesOverlap(bbox, p.bbox));
    if (!collides) {
      return { x, y, angle, fontSize: size, width, height, bbox };
    }
  }
  return null;
};

const drawWordCloud = () => {
  if (!wordCloudCanvas) return;
  const ctx = wordCloudCanvas.getContext("2d");
  ctx.clearRect(0, 0, WORD_CLOUD_BASE.width, WORD_CLOUD_BASE.height);
  if (!wordCloudState.placements.length) {
    setWordCloudMessage("暂无可用文本生成词云。");
    return;
  }
  wordCloudState.placements.forEach((p) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.font = `${p.fontWeight} ${p.fontSize}px ${p.fontFamily}, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = p.color;
    if (wordCloudState.selected === p.text) {
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.strokeText(p.text, 0, 0);
    }
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  });
};

const toBaseCoords = (evt) => {
  const rect = wordCloudCanvas.getBoundingClientRect();
  const width = rect.width || WORD_CLOUD_BASE.width;
  const height = rect.height || WORD_CLOUD_BASE.height;
  const x = ((evt.clientX - rect.left) / width) * WORD_CLOUD_BASE.width;
  const y = ((evt.clientY - rect.top) / height) * WORD_CLOUD_BASE.height;
  return { x, y };
};

const hitTestWordCloud = (x, y) => {
  for (let i = wordCloudState.placements.length - 1; i >= 0; i -= 1) {
    const p = wordCloudState.placements[i];
    if (x >= p.bbox.x1 && x <= p.bbox.x2 && y >= p.bbox.y1 && y <= p.bbox.y2) {
      return p;
    }
  }
  return null;
};

let wordCloudEventsBound = false;
const bindWordCloudEvents = () => {
  if (wordCloudEventsBound || !wordCloudCanvas) return;
  wordCloudCanvas.addEventListener("mousemove", (evt) => {
    if (!wordCloudTooltip || !wordCloudState.placements.length) return;
    const { x, y } = toBaseCoords(evt);
    const hit = hitTestWordCloud(x, y);
    if (hit) {
      wordCloudTooltip.style.opacity = 1;
      wordCloudTooltip.textContent = `${hit.text}：${hit.value}`;
      const rect = wordCloudCanvas.getBoundingClientRect();
      wordCloudTooltip.style.left = `${evt.clientX - rect.left}px`;
      wordCloudTooltip.style.top = `${evt.clientY - rect.top}px`;
    } else {
      wordCloudTooltip.style.opacity = 0;
    }
  });
  wordCloudCanvas.addEventListener("mouseleave", () => {
    if (wordCloudTooltip) wordCloudTooltip.style.opacity = 0;
  });
  wordCloudCanvas.addEventListener("click", (evt) => {
    if (!wordCloudState.placements.length) return;
    const { x, y } = toBaseCoords(evt);
    const hit = hitTestWordCloud(x, y);
    wordCloudState.selected = hit ? hit.text : null;
    drawWordCloud();
  });
  wordCloudEventsBound = true;
};

const renderWordCloud = (rows) => {
  if (!wordCloudCanvas) return;
  const freq = {};
  rows.forEach((r) => {
    splitWords(r.content || "").forEach((w) => {
      freq[w] = (freq[w] || 0) + 1;
    });
  });
  const data = Object.entries(freq)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, WORD_CLOUD_CFG.maxWords);
  if (!data.length) {
    wordCloudState.placements = [];
    wordCloudState.selected = null;
    setWordCloudMessage("暂无可用文本生成词云。");
    return;
  }
  wordCloudCanvas.width = WORD_CLOUD_BASE.width;
  wordCloudCanvas.height = WORD_CLOUD_BASE.height;
  const ctx = wordCloudCanvas.getContext("2d");
  wordCloudState.selected = null;
  if (wordCloudTooltip) wordCloudTooltip.style.opacity = 0;
  const maxFreq = data[0].value;
  const minFreq = data[data.length - 1].value;
  const placements = [];
  data.forEach((item, idx) => {
    const fontSize = mapFontSize(item.value, minFreq, maxFreq);
    const fontFamily = WORD_CLOUD_FONTS[idx % WORD_CLOUD_FONTS.length];
    const fontWeight = idx === 0 ? 700 : idx < 5 ? 600 : 400 + (idx % 2) * 100;
    const placed = placeWord(ctx, item.name, fontSize, placements, fontWeight, fontFamily);
    if (placed) {
      const opacity = idx === 0 ? 0.92 : idx < 5 ? 0.78 : 0.62 + Math.random() * 0.08;
      placements.push({
        ...placed,
        text: item.name,
        value: item.value,
        color: `rgba(17,17,17,${opacity})`,
        fontFamily,
        fontWeight,
        opacity,
      });
    }
  });
  wordCloudState.placements = placements;
  drawWordCloud();
  bindWordCloudEvents();
};

const resetWordCloudHighlight = () => {
  wordCloudState.selected = null;
  drawWordCloud();
};

window.resetWordCloudHighlight = resetWordCloudHighlight;

const setRegionMessage = (text) => {
  if (!chartEls.region) return;
  const ctx = chartEls.region.getContext("2d");
  chartEls.region.width = REGION_BASE.width;
  chartEls.region.height = REGION_BASE.height;
  ctx.clearRect(0, 0, REGION_BASE.width, REGION_BASE.height);
  ctx.save();
  ctx.fillStyle = "#b0b0b0";
  ctx.font = "16px 'Inter', 'Montserrat', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text || "暂无数据", REGION_BASE.width / 2, REGION_BASE.height / 2);
  ctx.restore();
  if (chartEls.regionTooltip) chartEls.regionTooltip.style.opacity = 0;
  if (chartEls.regionLegend) chartEls.regionLegend.innerHTML = "";
  regionState.petals = [];
  regionState.selected = null;
};

const mapGrayValue = (value, maxValue) => {
  const minG = REGION_CFG.minGray;
  const maxG = REGION_CFG.maxGray;
  if (maxValue <= 0) return minG;
  const g = minG - (value / maxValue) * (minG - maxG);
  return Math.min(minG, Math.max(maxG, Math.round(g)));
};

const makePetalPath = (cx, cy, angle, length) => {
  const innerR = 36;
  const w = REGION_CFG.petalWidth;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;
  const r0 = innerR;
  const r1 = length;
  const baseLeft = { x: cx + dirX * r0 + perpX * (-w / 2), y: cy + dirY * r0 + perpY * (-w / 2) };
  const baseRight = { x: cx + dirX * r0 + perpX * (w / 2), y: cy + dirY * r0 + perpY * (w / 2) };
  const tip = { x: cx + dirX * r1, y: cy + dirY * r1 };
  const c1 = { x: cx + dirX * (r0 + (r1 - r0) * 0.55) + perpX * (-w * 0.45), y: cy + dirY * (r0 + (r1 - r0) * 0.55) + perpY * (-w * 0.45) };
  const c2 = { x: cx + dirX * (r0 + (r1 - r0) * 0.55) + perpX * (w * 0.45), y: cy + dirY * (r0 + (r1 - r0) * 0.55) + perpY * (w * 0.45) };
  const path = new Path2D();
  path.moveTo(baseLeft.x, baseLeft.y);
  path.bezierCurveTo(c1.x, c1.y, tip.x, tip.y, baseRight.x, baseRight.y);
  path.bezierCurveTo(c2.x, c2.y, tip.x, tip.y, baseLeft.x, baseLeft.y);
  path.closePath();
  return { path, tip };
};

const drawRegionPetals = () => {
  if (!chartEls.region) return;
  const ctx = chartEls.region.getContext("2d");
  ctx.clearRect(0, 0, REGION_BASE.width, REGION_BASE.height);
  if (!regionState.petals.length) {
    setRegionMessage("暂无地域数据");
    return;
  }
  regionState.petals.forEach((p) => {
    ctx.save();
    ctx.fillStyle = `rgb(${p.gray},${p.gray},${p.gray})`;
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 0.6;
    if (regionState.selected && regionState.selected !== p.name) {
      ctx.globalAlpha = 0.38;
    }
    ctx.fill(p.path);
    ctx.stroke(p.path);
    ctx.restore();
  });
  regionState.petals.forEach((p) => {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "11px 'Inter','Work Sans',sans-serif";
    const offset = 12;
    const labelX = p.tip.x + Math.cos(p.angle) * offset;
    const labelY = p.tip.y + Math.sin(p.angle) * offset;
    ctx.fillText(`${p.name}`, labelX, labelY - 8);
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.font = "10px 'Inter','Work Sans',sans-serif";
    ctx.fillText(`${p.value} (${p.pct}%)`, labelX, labelY + 6);
    ctx.restore();
  });
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(REGION_BASE.width / 2, REGION_BASE.height / 2, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (chartEls.regionTooltip) chartEls.regionTooltip.style.opacity = 0;
};

const normalizeRegionName = (raw = "") => {
  const text = raw.trim();
  if (!text) return "";
  const regionAliases = [
    { name: "北京", aliases: ["北京"] },
    { name: "天津", aliases: ["天津"] },
    { name: "上海", aliases: ["上海"] },
    { name: "重庆", aliases: ["重庆"] },
    { name: "河北", aliases: ["河北"] },
    { name: "山西", aliases: ["山西"] },
    { name: "内蒙古", aliases: ["内蒙古", "内蒙"] },
    { name: "辽宁", aliases: ["辽宁"] },
    { name: "吉林", aliases: ["吉林"] },
    { name: "黑龙江", aliases: ["黑龙江"] },
    { name: "江苏", aliases: ["江苏"] },
    { name: "浙江", aliases: ["浙江"] },
    { name: "安徽", aliases: ["安徽"] },
    { name: "福建", aliases: ["福建"] },
    { name: "江西", aliases: ["江西"] },
    { name: "山东", aliases: ["山东"] },
    { name: "河南", aliases: ["河南"] },
    { name: "湖北", aliases: ["湖北"] },
    { name: "湖南", aliases: ["湖南"] },
    { name: "广东", aliases: ["广东"] },
    { name: "广西", aliases: ["广西"] },
    { name: "海南", aliases: ["海南"] },
    { name: "四川", aliases: ["四川"] },
    { name: "贵州", aliases: ["贵州"] },
    { name: "云南", aliases: ["云南"] },
    { name: "西藏", aliases: ["西藏"] },
    { name: "陕西", aliases: ["陕西"] },
    { name: "甘肃", aliases: ["甘肃"] },
    { name: "青海", aliases: ["青海"] },
    { name: "宁夏", aliases: ["宁夏"] },
    { name: "新疆", aliases: ["新疆"] },
    { name: "台湾", aliases: ["台湾"] },
    { name: "香港", aliases: ["香港"] },
    { name: "澳门", aliases: ["澳门"] },
  ];
  for (const item of regionAliases) {
    if (item.aliases.some((a) => text.includes(a))) return item.name;
  }
  return text;
};

const updateRegionLegend = (maxValue) => {
  if (!chartEls.regionLegend) return;
  chartEls.regionLegend.innerHTML = `
    <div class="legend-bar"></div>
    <div class="legend-labels">
      <span>0</span>
      <span>${Math.round(maxValue / 2)}</span>
      <span>${maxValue}</span>
    </div>
  `;
};

const hitTestRegion = (x, y) => {
  if (!chartEls.region) return null;
  const ctx = chartEls.region.getContext("2d");
  for (let i = regionState.petals.length - 1; i >= 0; i -= 1) {
    const p = regionState.petals[i];
    if (ctx.isPointInPath(p.path, x, y)) {
      return p;
    }
  }
  return null;
};

let regionEventsBound = false;
const bindRegionEvents = () => {
  if (regionEventsBound || !chartEls.region) return;
  chartEls.region.addEventListener("mousemove", (evt) => {
    if (!chartEls.regionTooltip || !regionState.petals.length) return;
    const rect = chartEls.region.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / (rect.width || REGION_BASE.width)) * REGION_BASE.width;
    const y = ((evt.clientY - rect.top) / (rect.height || REGION_BASE.height)) * REGION_BASE.height;
    const hit = hitTestRegion(x, y);
    if (hit) {
      chartEls.regionTooltip.style.opacity = 1;
      chartEls.regionTooltip.textContent = `${hit.name}：${hit.pct}% / ${hit.value}`;
      chartEls.regionTooltip.style.left = `${evt.clientX - rect.left}px`;
      chartEls.regionTooltip.style.top = `${evt.clientY - rect.top}px`;
    } else {
      chartEls.regionTooltip.style.opacity = 0;
    }
  });
  chartEls.region.addEventListener("mouseleave", () => {
    if (chartEls.regionTooltip) chartEls.regionTooltip.style.opacity = 0;
  });
  chartEls.region.addEventListener("click", (evt) => {
    if (!regionState.petals.length) return;
    const rect = chartEls.region.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / (rect.width || REGION_BASE.width)) * REGION_BASE.width;
    const y = ((evt.clientY - rect.top) / (rect.height || REGION_BASE.height)) * REGION_BASE.height;
    const hit = hitTestRegion(x, y);
    regionState.selected = hit ? hit.name : null;
    drawRegionPetals();
  });
  regionEventsBound = true;
};

const renderRegion = (rows) => {
  const counts = {};
  rows.forEach((r) => {
    const raw = (r.ip || "").replace(/^·\s*/, "").trim();
    const region = normalizeRegionName(raw || "未知");
    counts[region] = (counts[region] || 0) + 1;
  });
  if (!chartEls.region) return;
  if (!Object.keys(counts).length) {
    setRegionMessage("暂无地域数据");
    return;
  }
  chartEls.region.width = REGION_BASE.width;
  chartEls.region.height = REGION_BASE.height;
  const entries = Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const top = entries.slice(0, REGION_CFG.maxRegions - 1);
  const rest = entries.slice(REGION_CFG.maxRegions - 1);
  if (rest.length) {
    const restSum = rest.reduce((sum, d) => sum + d.value, 0);
    top.push({ name: "其他", value: restSum });
  }
  const maxValue = top.reduce((m, t) => Math.max(m, t.value), 1);
  regionState.maxValue = maxValue;
  regionState.petals = [];
  const n = top.length;
  const centerAngle = -Math.PI / 2;
  const angleStep = (Math.PI * 2) / n;
  const minLen = REGION_CFG.minLength;
  const maxLen = REGION_CFG.maxLength;
  const total = top.reduce((sum, t) => sum + t.value, 0) || 1;
  top.forEach((item, idx) => {
    const angle = centerAngle + idx * angleStep;
    const len = minLen + (item.value / maxValue) * (maxLen - minLen);
    const { path, tip } = makePetalPath(REGION_BASE.width / 2, REGION_BASE.height / 2, angle, len);
    const gray = mapGrayValue(item.value, maxValue);
    regionState.petals.push({
      name: item.name,
      value: item.value,
      pct: ((item.value / total) * 100).toFixed(1),
      angle,
      length: len,
      gray,
      path,
      tip,
    });
  });
  regionState.selected = null;
  drawRegionPetals();
  updateRegionLegend(maxValue);
  bindRegionEvents();
};

const dedupeRows = (rows) => {
  const seenIds = new Set();
  const seenKeys = new Set();
  const result = [];
  rows.forEach((r) => {
    const idKey = (r.comment_id || "").trim();
    if (idKey) {
      if (seenIds.has(idKey)) return;
      seenIds.add(idKey);
    }
    const key = `${r.user || ""}::${r.ip || ""}::${r.content || ""}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    result.push(r);
  });
  return result;
};

const analyze = (rows) => {
  const cleaned = rows
    .map((r) => ({
      ...r,
      likes: Number(r.likes) || 0,
      user: (r.user || "").trim(),
      ip: (r.ip || "").trim(),
      content: (r.content || "").trim(),
    }))
    .filter((r) => (r.user || r.ip) && r.content);
  const deduped = dedupeRows(cleaned);
  updateStats(deduped);
  renderTopUsers(deduped);
  renderTopLikes(deduped);
  renderWordCloud(deduped);
  renderRegion(deduped);
};

const parseCsvText = (text) => {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && next === "\n") i++; // handle CRLF
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] || "";
    });
    return obj;
  });
};

const analyzeCsvText = (text) => {
  analyze(parseCsvText(text));
};

const processCSV = () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    alert("请先选择 CSV 文件");
    return;
  }
  file.text().then((txt) => {
    setFileName(file.name);
    analyzeCsvText(txt);
  }).catch((err) => alert("解析失败：" + err.message));
};

window.processCSV = processCSV;

fileInput.addEventListener("change", function () {
  const fileName = this.files[0] ? this.files[0].name : "未选择文件";
  setFileName(fileName);
});

// Support messages from extension to auto-load CSV
if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "XHH_ANALYZE_DATA" && msg.csv && !autoLoaded) {
      autoLoaded = true;
      setFileName(msg.filename || "已自动加载数据");
      analyzeCsvText(msg.csv);
      if (msg.filename) {
        document.title = `评论数据可视化 - ${msg.filename}`;
      }
      sendResponse && sendResponse({ status: "loaded" });
      return true;
    }
    return false;
  });
}

// 初始展示提示
setWordCloudMessage("请上传 CSV 并点击“开始分析”生成词云。");
setRegionMessage("请上传 CSV 并点击“开始分析”查看地域分布。");

window.addEventListener("resize", () => {
  drawWordCloud();
  drawRegionPetals();
});
