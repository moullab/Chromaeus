/* ===== App Logic & State ===== */
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));

/* ===== State ===== */
const state = {
    theme: localStorage.getItem('Chromaeus_theme') || 'light',
    image: null, off: { canvas: null, ctx: null },
    view: { zoom: 1 },
    tool: { mode: 'rect', areaMode: 'vary', fixedSize: { w: 80, h: 80 }, drag: null, fixedPrimed: false, ghost: false },
    rois: [], nextId: 1,
    // Added meanRGB: true
    tableCols: { swatch: true, id: true, meanRGB:true, R: true, G: true, B: true, H: false, S: false, V: false, L: false, a: false, b: false, C: false, M: false, Y: false, K: false, px: true, hex: true, actions: true },
    activeSpaces: new Set(['RGB']),
    swatchesShown: false,
    calib: {
        drawerWidth: parseInt(localStorage.getItem('Chromaeus_drawer_w') || '520', 10),
        profiles: JSON.parse(localStorage.getItem('calib_profiles_v1') || '[]'),
        working: { name: 'Untitled', unit: 'mg L^-1', metric: 'meanRGB', points: {}, fit: { model: 'linear', weighting: 'none', params: null, r2: null, rmse: null, lod: null, loq: null, blankLevel: null, method: 'resid' } }
    },
    measure: { metrics: new Set(['meanRGB']) },
    history: { stack: [], redo: [] }
};

/* ===== Theme toggle ===== */
const root = document.documentElement;
function applyTheme() { root.setAttribute('data-theme', state.theme); $('#themeName').textContent = state.theme === 'light' ? 'Light' : 'Dark'; $('#themeSwitch').classList.toggle('on', state.theme === 'dark'); }
applyTheme();
$('#themeSwitch').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; localStorage.setItem('Chromaeus_theme', state.theme); applyTheme(); drawCanvas(); drawChart(); });
$('#themeSwitch').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#themeSwitch').click(); } });

/* ===== Canvas & buffers ===== */
const canvas = $('#canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const wrap = $('#canvasWrap'), inner = $('#innerCanvas');
const floatTable = $('#floatTable');
const floatTableHead = floatTable.querySelector('.floatTableHead');

let ftDragging = false;
let ftStartX = 0, ftStartY = 0;
let ftStartLeft = 0, ftStartTop = 0;

function ensureOffscreen() {
    if (!state.image) return;
    if (!state.off.canvas) { state.off.canvas = document.createElement('canvas'); state.off.ctx = state.off.canvas.getContext('2d', { willReadFrequently: true }); }
    state.off.canvas.width = state.image.naturalWidth; state.off.canvas.height = state.image.naturalHeight;
    state.off.ctx.setTransform(1, 0, 0, 1, 0, 0); state.off.ctx.clearRect(0, 0, state.off.canvas.width, state.off.canvas.height);
    state.off.ctx.drawImage(state.image, 0, 0);
}
function fitCanvasToImage() {
    if (!state.image) return;
    canvas.width = state.image.naturalWidth; canvas.height = state.image.naturalHeight;
    const maxW = wrap.clientWidth - 16, maxH = wrap.clientHeight - 16;
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
    state.view.zoom = scale; setZoomUI();
    inner.style.transform = `scale(${state.view.zoom})`;
    inner.style.transformOrigin = 'top left';
    wrap.scrollTo({ left: 0, top: 0 });
    drawCanvas();
}
function setZoomUI() { $('#zoomSlider').value = Math.round(state.view.zoom * 100); $('#zoomVal').textContent = Math.round(state.view.zoom * 100) + '%'; }
function clearCtx() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
function drawCanvas() {
    clearCtx(); if (!state.image) return; ctx.drawImage(state.image, 0, 0);
    const inCalib = $('#calibDrawer').classList.contains('open');
    const stroke = inCalib ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#23d9b4' : '#41d36a';
    ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = stroke;
    state.rois.forEach(roi => {
        if (roi.type === 'rect') { ctx.strokeRect(roi.geom.x, roi.geom.y, roi.geom.w, roi.geom.h); }
        else { ctx.beginPath(); ctx.arc(roi.geom.cx, roi.geom.cy, roi.geom.r, 0, Math.PI * 2); ctx.stroke(); }
    });
    ctx.restore();

    if (state.tool.drag) {
        ctx.save(); ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#23d9b4';
        const { x0, y0, x1, y1 } = state.tool.drag; const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        if (state.tool.mode === 'rect') { ctx.strokeRect(x, y, w, h); }
        else { const r = Math.min(w, h) / 2; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
    } else if (state.tool.areaMode === 'fix' && state.tool.fixedPrimed && state.tool.ghost) {
        const g = state.tool.fixedSize; const { x, y } = lastMouseImgPos || { x: 0, y: 0 };
        ctx.save(); ctx.globalAlpha = .35; ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#23d9b4';
        if (state.tool.mode === 'rect') { ctx.fillRect(Math.round(x - g.w / 2), Math.round(y - g.h / 2), g.w, g.h); }
        else { const r = Math.floor(Math.min(g.w, g.h) / 2); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }
}
function clientToImage(evt) {
    const rect = wrap.getBoundingClientRect();
    const x = (evt.clientX - rect.left + wrap.scrollLeft) / state.view.zoom;
    const y = (evt.clientY - rect.top + wrap.scrollTop) / state.view.zoom;
    return { x: clamp(Math.round(x), 0, canvas.width - 1), y: clamp(Math.round(y), 0, canvas.height - 1) };
}

/* ===== File load (Supports TIFF) ===== */
$('#fileInput').addEventListener('change', e => {
    const f = e.target.files?.[0]; if (!f) return;
    
    const startApp = (src) => {
        const img = new Image();
        img.onload = () => { 
            state.image = img; 
            ensureOffscreen(); 
            fitCanvasToImage(); 
            state.rois = []; 
            state.nextId = 1; 
            renderTable(); 
            renderRoiBar(); 
            buildCalibrationTable(); 
            drawChart(); 
            fillBlankLevels(); 
        };
        img.src = src;
    };

    const name = f.name.toLowerCase();
    if (typeof UTIF !== 'undefined' && (name.endsWith('.tif') || name.endsWith('.tiff'))) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const buffer = event.target.result;
            const ifds = UTIF.decode(buffer);
            UTIF.decodeImage(buffer, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);
            const cnv = document.createElement('canvas');
            cnv.width = ifds[0].width;
            cnv.height = ifds[0].height;
            const ctx = cnv.getContext('2d');
            const imgData = ctx.createImageData(cnv.width, cnv.height);
            imgData.data.set(rgba);
            ctx.putImageData(imgData, 0, 0);
            startApp(cnv.toDataURL());
        };
        reader.readAsArrayBuffer(f);
    } else {
        startApp(URL.createObjectURL(f));
    }
});

/* ===== Zoom / Pan / Scroll ===== */
$('#zoomSlider').addEventListener('input', () => { state.view.zoom = +$('#zoomSlider').value / 100; setZoomUI(); inner.style.transform = `scale(${state.view.zoom})`; drawCanvas(); });
wrap.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -Math.sign(e.deltaY) * 0.05;
        state.view.zoom = clamp(state.view.zoom * (1 + delta), 0.1, 5);
        setZoomUI(); inner.style.transform = `scale(${state.view.zoom})`; drawCanvas();
    } else {
        if (e.shiftKey) { wrap.scrollLeft += e.deltaY; e.preventDefault(); }
    }
}, { passive: false });

/* Space-drag panning */
let spaceDown = false, dragging = false, last = { x: 0, y: 0 };
document.addEventListener('keydown', e => { if (e.code === 'Space') { spaceDown = true; } });
document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; dragging = false; } });
wrap.addEventListener('mousedown', e => { if (spaceDown) { dragging = true; last.x = e.clientX; last.y = e.clientY; e.preventDefault(); } });
document.addEventListener('mousemove', e => {
    if (dragging) { const dx = last.x - e.clientX, dy = last.y - e.clientY; wrap.scrollLeft += dx; wrap.scrollTop += dy; last.x = e.clientX; last.y = e.clientY; }
});
document.addEventListener('mouseup', () => dragging = false);

// ===== Draggable results table =====
floatTableHead.addEventListener('mousedown', e => {
    ftDragging = true;
    const rect = floatTable.getBoundingClientRect();
    ftStartX = e.clientX; ftStartY = e.clientY; ftStartLeft = rect.left; ftStartTop = rect.top;
    floatTable.style.right = 'auto'; floatTable.style.left = ftStartLeft + 'px'; floatTable.style.top = ftStartTop + 'px';
    document.body.style.userSelect = 'none';
});
window.addEventListener('mousemove', e => {
    if (!ftDragging) return;
    const dx = e.clientX - ftStartX; const dy = e.clientY - ftStartY;
    floatTable.style.left = (ftStartLeft + dx) + 'px'; floatTable.style.top = (ftStartTop + dy) + 'px';
});
window.addEventListener('mouseup', () => { if (ftDragging) { ftDragging = false; document.body.style.userSelect = ''; } });

/* Track mouse for ghost */
let lastMouseImgPos = null;
wrap.addEventListener('mousemove', e => { lastMouseImgPos = clientToImage(e); if (state.tool.areaMode === 'fix' && state.tool.fixedPrimed) { state.tool.ghost = true; drawCanvas(); } });

/* ===== Selection Tools Switcher ===== */
function setTool(mode) {
    state.tool.mode = mode;
    state.tool.fixedPrimed = false; 
    state.tool.ghost = false;
    state.tool.drag = null;
    drawCanvas();
    
    $('#toolRect').classList.toggle('active', mode === 'rect');
    $('#toolCircle').classList.toggle('active', mode === 'circle');
    $('#toolWand').classList.toggle('active', mode === 'wand');
}

$('#toolRect').onclick = () => setTool('rect');
$('#toolCircle').onclick = () => setTool('circle');
$('#toolWand').onclick = () => setTool('wand');

$('#areaModeBtn').onclick = () => {
    if (state.tool.areaMode === 'vary') { 
        state.tool.areaMode = 'fix'; 
        state.tool.fixedPrimed = false; 
        $('#areaModeBtn').textContent = 'Vary area'; 
    } else { 
        state.tool.areaMode = 'vary'; 
        $('#areaModeBtn').textContent = 'Fix area'; 
    }
    drawCanvas();
};

/* ===== History (Undo/Redo) ===== */
function pushHistory(action) { state.history.stack.push(action); state.history.redo.length = 0; }
function undo() {
    const a = state.history.stack.pop(); if (!a) return;
    if (a.type === 'add') { state.rois = state.rois.filter(r => r.id !== a.roi.id); delete state.calib.working.points[a.roi.id]; }
    else if (a.type === 'del') { state.rois.push(a.roi); state.calib.working.points[a.roi.id] = a.calibPoint || { include: true, level: null, unit: state.calib.working.unit, isBlank: false }; }
    state.history.redo.push(a);
    renderTable(); renderRoiBar(); buildCalibrationTable(); drawChart(); drawCanvas();
}
function redo() {
    const a = state.history.redo.pop(); if (!a) return;
    if (a.type === 'add') { state.rois.push(a.roi); state.calib.working.points[a.roi.id] = a.calibPoint || { include: true, level: null, unit: state.calib.working.unit, isBlank: false }; }
    else if (a.type === 'del') { state.rois = state.rois.filter(r => r.id !== a.roi.id); delete state.calib.working.points[a.roi.id]; }
    state.history.stack.push(a);
    renderTable(); renderRoiBar(); buildCalibrationTable(); drawChart(); drawCanvas();
}
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
document.addEventListener('keydown', e => {
    const z = (e.key === 'z' || e.key === 'Z'), y = (e.key === 'y' || e.key === 'Y');
    if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey)))) { e.preventDefault(); redo(); }
});

/* ===== ROI measure ===== */
function measureROI(roi) {
    const off = state.off; if (!off.canvas) return;
    const d = off.ctx.getImageData(0, 0, off.canvas.width, off.canvas.height).data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0; const W = off.canvas.width;
    function acc(i, j) { const idx = (j * W + i) * 4; rSum += d[idx]; gSum += d[idx + 1]; bSum += d[idx + 2]; }
    if (roi.type === 'rect') {
        const { x, y, w, h } = roi.geom;
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) acc(i, j), count++;
    } else {
        const { cx, cy, r } = roi.geom, x0 = cx - r, y0 = cy - r, w = r * 2, h = r * 2;
        for (let j = y0; j < y0 + h; j++) for (let i = x0; i < x0 + w; i++) { const dx = i - cx, dy = j - cy; if (dx * dx + dy * dy <= r * r) { acc(i, j); count++; } }
    }
    const r = rSum / count, g = gSum / count, b = bSum / count;
    const hsv = RGBtoHSV(r, g, b), lab = RGBtoLab(r, g, b), cmyk = RGBtoCMYK(r, g, b);
    roi.px = count; roi.metrics = { rgb: { r: Math.round(r), g: Math.round(g), b: Math.round(b), mean: (r + g + b) / 3 }, hsv, lab, cmyk, hex: rgbToHex(Math.round(r), Math.round(g), Math.round(b)) };
}
function addROI(spec) {
    const id = state.nextId++; const roi = { id, type: spec.type, geom: spec.geom }; measureROI(roi);
    state.rois.push(roi);
    pushHistory({ type: 'add', roi: JSON.parse(JSON.stringify(roi)) });
    if (!state.calib.working.points[id]) state.calib.working.points[id] = { include: true, level: null, unit: state.calib.working.unit, isBlank: false };
    renderTable(); renderRoiBar(); buildCalibrationTable(); drawChart(); drawCanvas();
}

/* ===== Table ===== */
const colLabels = { swatch: 'Sw', id: 'ID', meanRGB: 'Mean', R: 'R', G: 'G', B: 'B', H: 'H', S: 'S', V: 'V', L: 'L*', a: 'a*', b: 'b*', C: 'C', M: 'M', Y: 'Y', K: 'K', px: 'px', hex: 'hex', actions: '' };
function renderHeader() { $('#theadRow').innerHTML = Object.keys(state.tableCols).filter(k => state.tableCols[k]).map(k => `<th>${colLabels[k] || k}</th>`).join(''); }
function renderTable() {
    renderHeader();
    $('#tbody').innerHTML = state.rois.map(r => {
        const m = r.metrics; const cells = [];
        const push = (key, val) => { if (state.tableCols[key]) cells.push(`<td>${val}</td>`); };
        if (state.tableCols.swatch) cells.push(`<td><span class="swatch" style="background:${m.hex}"></span></td>`);
        if (state.tableCols.id) cells.push(`<td>${r.id}</td>`);
        push('meanRGB', m.rgb.mean.toFixed(1));
        push('R', Math.round(m.rgb.r)); push('G', Math.round(m.rgb.g)); push('B', Math.round(m.rgb.b));
        push('H', m.hsv.h.toFixed(1)); push('S', (m.hsv.s * 100).toFixed(1)); push('V', (m.hsv.v * 100).toFixed(1));
        push('L', m.lab.L.toFixed(2)); push('a', m.lab.a.toFixed(2)); push('b', m.lab.b.toFixed(2));
        push('C', (m.cmyk.c * 100).toFixed(1)); push('M', (m.cmyk.m * 100).toFixed(1)); push('Y', (m.cmyk.y * 100).toFixed(1)); push('K', (m.cmyk.k * 100).toFixed(1));
        push('px', r.px); push('hex', m.hex);
        if (state.tableCols.actions) cells.push(`<td><button class="btn danger tiny" data-del="${r.id}">Del</button></td>`);
        return `<tr>${cells.join('')}</tr>`;
    }).join('');
    $$('#tbody [data-del]').forEach(b => {
        b.onclick = () => {
            const id = +b.dataset.del;
            const roi = state.rois.find(x => x.id === id);
            const calibPoint = state.calib.working.points[id];
            state.rois = state.rois.filter(r => r.id !== id); delete state.calib.working.points[id];
            pushHistory({ type: 'del', roi: roi, calibPoint: calibPoint });
            renderTable(); renderRoiBar(); buildCalibrationTable(); drawChart(); drawCanvas();
        };
    });
}
function renderColToggles() {
    const c = $('#colToggles'); c.innerHTML = '';
    Object.keys(state.tableCols).forEach(k => {
        if (k === 'actions') return;
        const btn = document.createElement('button');
        btn.className = 'chipbtn tiny' + (state.tableCols[k] ? ' active' : '');
        const label = colLabels[k] || k;
        btn.textContent = label; 
        btn.onclick = () => { state.tableCols[k] = !state.tableCols[k]; renderTable(); renderColToggles(); };
        c.appendChild(btn);
    });
}
renderColToggles();

/* Toggles */
function syncToggles() {
    $('#floatTable').style.display = $('#toggleTableBtn').classList.contains('on') ? 'block' : 'none';
    $('#roiBar').style.display = $('#toggleSwatchesBtn').classList.contains('on') ? 'flex' : 'none';
}
$('#toggleTableBtn').classList.add('on');
$('#toggleSwatchesBtn').classList.remove('on');
syncToggles();
$('#toggleTableBtn').onclick = () => { $('#toggleTableBtn').classList.toggle('on'); syncToggles(); };
$('#toggleSwatchesBtn').onclick = () => { $('#toggleSwatchesBtn').classList.toggle('on'); state.swatchesShown = $('#toggleSwatchesBtn').classList.contains('on'); syncToggles(); };
$('#resetBtn').onclick = () => { state.rois = []; state.nextId = 1; state.history.stack = []; state.history.redo = []; renderTable(); renderRoiBar(); buildCalibrationTable(); drawChart(); drawCanvas(); };
$('#copyBtn').onclick = () => {
    const cols = Object.keys(state.tableCols).filter(k => state.tableCols[k] && k !== 'actions');
    const header = cols.map(k => colLabels[k]).join(',');
    const rows = state.rois.map(r => {
        const m = r.metrics; const map = { swatch: '', id: r.id, meanRGB: m.rgb.mean.toFixed(1), R: m.rgb.r, G: m.rgb.g, B: m.rgb.b, H: m.hsv.h, S: m.hsv.s, V: m.hsv.v, L: m.lab.L, a: m.lab.a, b: m.lab.b, C: m.cmyk.c, M: m.cmyk.m, Y: m.cmyk.y, K: m.cmyk.k, px: r.px, hex: m.hex };
        return cols.map(k => map[k]).join(',');
    }).join('\n');
    navigator.clipboard.writeText([header, rows].join('\n')); $('#copyBtn').textContent = 'Copied!'; setTimeout(() => $('#copyBtn').textContent = 'Copy', 1000);
};
$('#exportBtn').onclick = () => {
    const cols = Object.keys(state.tableCols).filter(k => state.tableCols[k] && k !== 'actions');
    const header = cols.map(k => colLabels[k]).join(',');
    const rows = state.rois.map(r => {
        const m = r.metrics; const map = { swatch: '', id: r.id, meanRGB: m.rgb.mean.toFixed(1), R: m.rgb.r, G: m.rgb.g, B: m.rgb.b, H: m.hsv.h, S: m.hsv.s, V: m.hsv.v, L: m.lab.L, a: m.lab.a, b: m.lab.b, C: m.cmyk.c, M: m.cmyk.m, Y: m.cmyk.y, K: m.cmyk.k, px: r.px, hex: m.hex };
        return cols.map(k => map[k]).join(',');
    }).join('\n');
    const blob = new Blob([[header, rows].join('\n')], { type: 'text/csv;charset=utf-8;' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rois.csv'; a.click();
};

/* ROI thumbs: left = actual ROI, right = averaged color */
function renderRoiBar() {
    const bar = $('#roiBar'); bar.innerHTML = '';
    if (!state.off.canvas || !state.off.ctx) return;
    const offCanvas = state.off.canvas;
    state.rois.forEach(r => {
        const d = document.createElement('div');
        d.className = 'thumb';

        const c = document.createElement('canvas');
        c.width = 120; c.height = 64;
        const t = c.getContext('2d');

        // left half: ROI image
        const halfW = 60;
        if (r.type === 'rect') {
            const { x, y, w, h } = r.geom;
            t.drawImage(offCanvas, x, y, w, h, 0, 0, halfW, c.height);
        } else {
            const { cx, cy, r: rr } = r.geom;
            const x0 = cx - rr, y0 = cy - rr, w = rr * 2, h = rr * 2;
            t.drawImage(offCanvas, x0, y0, w, h, 0, 0, halfW, c.height);
        }

        // right half: averaged color
        t.fillStyle = r.metrics.hex;
        t.fillRect(halfW, 0, halfW, c.height);

        d.appendChild(c);
        bar.appendChild(d);
    });
}

/* Color spaces (Corrected) */
const spaceToCols = { RGB: ['R', 'G', 'B'], HSV: ['H', 'S', 'V'], LAB: ['L', 'a', 'b'], CMYK: ['C', 'M', 'Y', 'K'] };
$('#spaceButtons').addEventListener('click', e => {
    const b = e.target.closest('button[data-space]'); if (!b) return;
    const sp = b.dataset.space; const isActive = b.classList.toggle('active');
    if (isActive) state.activeSpaces.add(sp); else state.activeSpaces.delete(sp);
    
    // Reset
    Object.keys(state.tableCols).forEach(k => { 
        if (['R', 'G', 'B', 'H', 'S', 'V', 'L', 'a', 'b', 'C', 'M', 'Y', 'K'].includes(k)) state.tableCols[k] = false; 
    });
    // Activate
    state.activeSpaces.forEach(space => spaceToCols[space].forEach(k => state.tableCols[k] = true));
    renderColToggles(); 
    renderTable();
});

/* ===== Drag-drop load ===== */
['dragenter', 'dragover'].forEach(evt => wrap.addEventListener(evt, e => { e.preventDefault(); }));
wrap.addEventListener('drop', e => {
    e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (!f) return; $('#fileInput').files = e.dataTransfer.files; $('#fileInput').dispatchEvent(new Event('change'));
});

/* ===== Calibration ===== */
const drawer = $('#calibDrawer'), dragHandle = $('#dragHandle');
function openDrawer() { drawer.classList.add('open'); drawer.style.width = state.calib.drawerWidth + 'px'; drawer.setAttribute('aria-hidden', 'false'); refreshCalibUI(); drawChart(); drawCanvas(); }
function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); drawCanvas(); }
$('#openCalib').onclick = () => {
    if (drawer.classList.contains('open')) {
        closeDrawer();
    } else {
        openDrawer();
    }
};
$('#closeCalib').onclick = closeDrawer;
/* Resize */
let resizing = false, startX = 0, startW = 0;
dragHandle.addEventListener('mousedown', e => { resizing = true; startX = e.clientX; startW = drawer.getBoundingClientRect().width; document.body.style.userSelect = 'none'; });
window.addEventListener('mousemove', e => {
    if (!resizing) return; const dx = startX - e.clientX; const w = clamp(startW + dx, 380, Math.min(900, window.innerWidth - 120)); drawer.style.width = w + 'px';
});
window.addEventListener('mouseup', () => { if (resizing) { resizing = false; document.body.style.userSelect = ''; state.calib.drawerWidth = parseInt(drawer.style.width, 10); localStorage.setItem('Chromaeus_drawer_w', state.calib.drawerWidth); } });

/* Saved calibrations */
function snapshotCalibration() { return { unit: state.calib.working.unit, metric: state.calib.working.metric, points: state.calib.working.points, fit: state.calib.working.fit }; }
function loadCalibration(data) { state.calib.working.unit = data.unit; state.calib.working.metric = data.metric; state.calib.working.points = data.points || {}; state.calib.working.fit = data.fit || { model: 'linear', weighting: 'none' }; }
$('#calibNew').onclick = () => { state.calib.working = { name: 'Untitled', unit: 'mg L^-1', metric: 'meanRGB', points: {}, fit: { model: 'linear', weighting: 'none', params: null, r2: null, rmse: null, lod: null, loq: null, blankLevel: null, method: 'blank' } }; refreshCalibUI(); drawChart(); };
$('#calibSave').onclick = () => {
    const name = state.calib.working.name || 'Untitled';
    state.calib.working.name = name;
    const idx = state.calib.profiles.findIndex(p => p.name === name);
    const payload = { name, data: snapshotCalibration() };
    if (idx >= 0) state.calib.profiles[idx] = payload; else state.calib.profiles.push(payload);
    localStorage.setItem('calib_profiles_v1', JSON.stringify(state.calib.profiles));
    refreshCalibUI();
    alert('Calibration saved.');
};
$('#calibSaveAs').onclick = () => {
    const nm = prompt('Save as name:', state.calib.working.name || 'New calibration');
    if (!nm) return;
    state.calib.working.name = nm; const payload = { name: nm, data: snapshotCalibration() };
    state.calib.profiles.push(payload);
    localStorage.setItem('calib_profiles_v1', JSON.stringify(state.calib.profiles));
    refreshCalibUI();
    alert('Calibration saved as ' + nm);
};
$('#calibLoad').onchange = e => { const idx = +e.target.value; const prof = state.calib.profiles[idx]; if (!prof) return; loadCalibration(prof.data); state.calib.working.name = prof.name; refreshCalibUI(); drawChart(); };

/* UI refresh */
function refreshCalibUI() {
    $('#calibName').value = state.calib.working.name;
    $('#unitInput').value = state.calib.working.unit;
    $('#metricSelect').value = state.calib.working.metric;

    const load = $('#calibLoad'); load.innerHTML = ''; state.calib.profiles.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; load.appendChild(o); });
    const use = $('#useCalib'); use.innerHTML = ''; const cur = document.createElement('option'); cur.value = '__current__'; cur.textContent = '(Current working)'; use.appendChild(cur);
    state.calib.profiles.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; use.appendChild(o); });

    const mm = $('#measureMetricBtns'); mm.innerHTML = '';
    [['meanRGB', 'Mean RGB'], ['R', 'R'], ['G', 'G'], ['B', 'B'], ['H', 'H'], ['S', 'S'], ['V', 'V'], ['L', 'L*'], ['a', 'a*'], ['b', 'b*'], ['C', 'C'], ['M', 'M'], ['Y', 'Y'], ['K', 'K']]
        .forEach(([key, label]) => {
            const b = document.createElement('button'); b.className = 'chipbtn tiny' + (state.measure.metrics.has(key) ? ' active' : ''); b.textContent = label;
            b.onclick = () => { if (state.measure.metrics.has(key)) state.measure.metrics.delete(key); else state.measure.metrics.add(key); b.classList.toggle('active'); };
            mm.appendChild(b);
        });

    $('#fitModel').value = state.calib.working.fit.model || 'linear';
    $('#weighting').value = state.calib.working.fit.weighting || 'none';
    $('#lodMethod').value = state.calib.working.fit.method || 'blank';
    fillBlankLevels();
    buildCalibrationTable();
}
$('#calibName').oninput = e => { state.calib.working.name = e.target.value; };
$('#unitInput').oninput = e => { state.calib.working.unit = e.target.value; Object.values(state.calib.working.points).forEach(p => p.unit = e.target.value); buildCalibrationTable(); };
$('#metricSelect').onchange = e => { state.calib.working.metric = e.target.value; buildCalibrationTable(); drawChart(); };
$('#aggMethod').onchange = () => drawChart();
$('#outlierTool').onchange = () => drawChart();
$('#fitModel').onchange = e => { state.calib.working.fit.model = e.target.value; drawChart(); };
$('#weighting').onchange = e => { state.calib.working.fit.weighting = e.target.value; drawChart(); };
$('#lodMethod').onchange = e => { state.calib.working.fit.method = e.target.value; drawChart(); };

function buildCalibrationTable() {
    const tb = $('#roiLevelTBody'); tb.innerHTML = '';
    const metric = state.calib.working.metric;
    state.rois.forEach(r => {
        const map = state.calib.working.points[r.id] || { include: true, level: null, unit: state.calib.working.unit, isBlank: false };
        state.calib.working.points[r.id] = map;
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td><input type="checkbox" data-inc="${r.id}" ${map.include ? 'checked' : ''}></td>
      <td>#${r.id} <span class="mini">${r.metrics.hex}</span></td>
      <td><input type="text" inputmode="decimal" data-lev="${r.id}" value="${map.level ?? ''}" placeholder="0, 5, 10"></td>
      <td><input type="text" data-unit="${r.id}" value="${map.unit || state.calib.working.unit}"></td>
      <td><input type="checkbox" data-blank="${r.id}" ${map.isBlank ? 'checked' : ''}></td>
      <td style="text-align:right">${nice(metricOf(r, metric))}</td>
    `;
        tb.appendChild(tr);
    });
    $$('#roiLevelTBody [data-inc]').forEach(cb => cb.onchange = () => { const id = +cb.dataset.inc; state.calib.working.points[id].include = cb.checked; drawChart(); });
    $$('#roiLevelTBody [data-lev]').forEach(inp => inp.oninput = () => { const id = +inp.dataset.lev; const v = inp.value.trim(); state.calib.working.points[id].level = v === '' ? null : Number(v); drawChart(); fillBlankLevels(); });
    $$('#roiLevelTBody [data-unit]').forEach(inp => inp.oninput = () => { const id = +inp.dataset.unit; state.calib.working.points[id].unit = inp.value; });
    $$('#roiLevelTBody [data-blank]').forEach(cb => cb.onchange = () => { const id = +cb.dataset.blank; state.calib.working.points[id].isBlank = cb.checked; drawChart(); });
}
function fillBlankLevels() {
    const s = $('#blankLevel'); s.innerHTML = '';
    const none = document.createElement('option'); none.value = 'none'; none.textContent = 'None'; s.appendChild(none);
    aggregateLevels().levels.forEach(L => { const o = document.createElement('option'); o.value = String(L.level); o.textContent = String(L.level); s.appendChild(o); });
    s.value = state.calib.working.fit.blankLevel || 'none';
    s.onchange = e => { state.calib.working.fit.blankLevel = e.target.value; drawChart(); };
}
function metricOf(roi, metric) {
    const m = roi.metrics;
    switch (metric) {
        case 'meanRGB': return m.rgb.mean;
        case 'R': return m.rgb.r; case 'G': return m.rgb.g; case 'B': return m.rgb.b;
        case 'H': return m.hsv.h; case 'S': return m.hsv.s; case 'V': return m.hsv.v;
        case 'L': return m.lab.L; case 'a': return m.lab.a; case 'b': return m.lab.b;
        case 'C': return m.cmyk.c; case 'M': return m.cmyk.m; case 'Y': return m.cmyk.y; case 'K': return m.cmyk.k;
        default: return m.rgb.mean;
    }
}
function aggregateLevels() {
    const pts = state.calib.working.points, metric = state.calib.working.metric;
    const rows = state.rois.filter(r => pts[r.id]?.include && (pts[r.id].level !== null && !isNaN(pts[r.id].level)));
    const by = {}; rows.forEach(r => { const L = Number(pts[r.id].level); (by[L] || (by[L] = [])).push(metricOf(r, metric)); });
    const method = $('#aggMethod').value; const ot = $('#outlierTool').value; const levels = [];
    Object.keys(by).map(Number).sort((a, b) => a - b).forEach(L => {
        let arr = [...by[L]];
        if (ot === 'iqr' && arr.length >= 4) { const s = [...arr].sort((a, b) => a - b); const q1 = s[Math.floor((s.length - 1) * 0.25)], q3 = s[Math.floor((s.length - 1) * 0.75)], iqr = q3 - q1; const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr; arr = arr.filter(v => v >= lo && v <= hi); }
        if (ot === 'grubbs' && arr.length >= 3) { const m = mean(arr), s = std(arr, m); if (s > 0) { const diffs = arr.map(v => Math.abs(v - m) / s); const idx = diffs.indexOf(Math.max(...diffs)); if (diffs[idx] > 2) arr.splice(idx, 1); } }
        let val = 0; if (method === 'mean') val = mean(arr); else if (method === 'median') val = median(arr); else val = trimmedMean(arr, 0.1);
        levels.push({ level: L, y: val });
    });
    return { levels, byLevel: by };
}

/* ===== Transform engine for X and Y ===== */
function applyTransforms(levels) {
    const tx = {
        log10: $('#tx_log10').checked,
        ln: $('#tx_ln').checked,
        inv: $('#tx_inv').checked
    };
    const ty = {
        log10: $('#ty_log10').checked,
        ln: $('#ty_ln').checked,
        inv: $('#ty_inv').checked
    };

    const out = [];

    for (const p of levels) {
        let x = p.level;
        let y = p.y;

        let ok = true;

        // X transforms
        if (tx.log10) { if (x > 0) x = Math.log10(x); else ok = false; }
        if (ok && tx.ln) { if (x > 0) x = Math.log(x); else ok = false; }
        if (ok && tx.inv) { if (x !== 0) x = 1 / x; else ok = false; }

        // Y transforms
        if (ok && ty.log10) { if (y > 0) y = Math.log10(y); else ok = false; }
        if (ok && ty.ln) { if (y > 0) y = Math.log(y); else ok = false; }
        if (ok && ty.inv) { if (y !== 0) y = 1 / y; else ok = false; }

        if (ok) {
            out.push({
                rawLevel: p.level,
                rawY: p.y,
                x: x,
                y: y
            });
        }
    }

    return out;
}

/* Recompute chart immediately when transform checkboxes change */
['tx_log10', 'tx_ln', 'tx_inv', 'ty_log10', 'ty_ln', 'ty_inv'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', () => {
            drawChart();
        });
    }
});

/* Helpers for axis labels */
function buildXLabel() {
    let label = 'Concentration (' + state.calib.working.unit + ')';
    const log10 = $('#tx_log10').checked;
    const ln = $('#tx_ln').checked;
    const inv = $('#tx_inv').checked;
    if (log10) label = `log₁₀(${label})`;
    if (ln) label = `ln(${label})`;
    if (inv) label = `1/(${label})`;
    return label;
}
function buildYLabel() {
    let label = state.calib.working.metric;
    const log10 = $('#ty_log10').checked;
    const ln = $('#ty_ln').checked;
    const inv = $('#ty_inv').checked;
    if (log10) label = `log₁₀(${label})`;
    if (ln) label = `ln(${label})`;
    if (inv) label = `1/(${label})`;
    return label;
}

/* ===== Fits & Chart ===== */
const chart = $('#chartCanvas'), cctx = chart.getContext('2d');
function niceTicks(min, max, steps = 6) {
    if (min === max) { const d = Math.abs(min) || 1; min -= d * 0.5; max += d * 0.5; }
    const span = max - min; const step = Math.pow(10, Math.floor(Math.log10(span / steps))); const err = (span / steps) / step;
    const mult = err >= 7 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
    const tick = mult * step; const tmin = Math.floor(min / tick) * tick; const tmax = Math.ceil(max / tick) * tick;
    const arr = []; for (let v = tmin; v <= tmax + 1e-12; v += tick) arr.push(v);
    return { ticks: arr, tmin, tmax };
}

function drawChart() {
    cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, chart.width, chart.height);
    const W = chart.width, H = chart.height, pad = 44;
    cctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel'); cctx.fillRect(0, 0, W, H);

    const agg = aggregateLevels();
    const rawLevels = agg.levels;
    const levels = applyTransforms(rawLevels);
    const eqBox = $('#eqBox');
    if (levels.length < 2) { eqBox.textContent = 'Add at least two levels to fit a curve.'; return; }

    const xmin = Math.min(...levels.map(p => p.x)), xmax = Math.max(...levels.map(p => p.x));
    const ymin = Math.min(...levels.map(p => p.y)), ymax = Math.max(...levels.map(p => p.y));
    const xnice = niceTicks(xmin, xmax, 5), ynice = niceTicks(ymin, ymax, 5);
    const X = x => pad + ((x - xnice.tmin) / (xnice.tmax - xnice.tmin)) * (W - 2 * pad);
    const Y = y => H - pad - ((y - ynice.tmin) / (ynice.tmax - ynice.tmin)) * (H - 2 * pad);

    cctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid'); cctx.lineWidth = 1;
    xnice.ticks.forEach(t => { const xx = X(t); cctx.beginPath(); cctx.moveTo(xx, pad); cctx.lineTo(xx, H - pad); cctx.stroke(); });
    ynice.ticks.forEach(t => { const yy = Y(t); cctx.beginPath(); cctx.moveTo(pad, yy); cctx.lineTo(W - pad, yy); cctx.stroke(); });
    cctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    cctx.beginPath(); cctx.moveTo(pad, H - pad); cctx.lineTo(W - pad, H - pad); cctx.moveTo(pad, H - pad); cctx.lineTo(pad, pad); cctx.stroke();

    cctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--chart-ink'); cctx.font = '12px Inter';
    const xLabel = buildXLabel();
    const yLabel = buildYLabel();

    cctx.textAlign = 'center'; xnice.ticks.forEach(t => cctx.fillText(nice(t), X(t), H - pad + 14));
    cctx.textAlign = 'right'; ynice.ticks.forEach(t => cctx.fillText(nice(t), pad - 6, Y(t) + 4));

    // Axis titles
    cctx.textAlign = 'center';
    cctx.fillText(xLabel, W / 2, H - 8);
    cctx.save();
    cctx.translate(16, H / 2);
    cctx.rotate(-Math.PI / 2);
    cctx.textAlign = 'center';
    cctx.fillText(yLabel, 0, 0);
    cctx.restore();

    // Data points
    cctx.fillStyle = '#66c2a5'; levels.forEach(p => { cctx.beginPath(); cctx.arc(X(p.x), Y(p.y), 3.5, 0, Math.PI * 2); cctx.fill(); });

    const model = $('#fitModel').value, weighting = $('#weighting').value; const fitRes = fitModel(levels.map(p => ({ level: p.x, y: p.y })), model, weighting);
    if (!fitRes.ok) { eqBox.textContent = fitRes.msg || 'Fit failed.'; return; }
    cctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#23d9b4'; cctx.lineWidth = 2; cctx.beginPath();
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
        const x = xnice.tmin + (xnice.tmax - xnice.tmin) * i / steps;
        let y;
        switch (model) {
            case 'linear': y = fitRes.params.a + fitRes.params.b * x; break;
            case 'log': y = fitRes.params.a + fitRes.params.b * Math.log(Math.max(1e-12, x)); break;
            case 'log10': y = fitRes.params.a + fitRes.params.b * Math.log10(Math.max(1e-12, x)); break;
            case 'exp': y = fitRes.params.a * Math.exp(fitRes.params.b * x); break;
            default: { const c = fitRes.params.coeff; y = c.reduce((s, a, j) => s + a * Math.pow(x, j), 0); }
        }
        if (i === 0) cctx.moveTo(X(x), Y(y)); else cctx.lineTo(X(x), Y(y));
    }
    cctx.stroke();

    const resid = fitRes.resid, s = std(resid), sr = resid.map(e => s ? e / s : 0);
    cctx.fillStyle = '#ff7b84'; levels.forEach((p, i) => { if (Math.abs(sr[i]) > 2) { cctx.beginPath(); cctx.arc(X(p.x), Y(p.y), 4.5, 0, Math.PI * 2); cctx.fill(); } });

    let blankStd = 0; const sel = $('#blankLevel').value; if (sel !== 'none') { const arr = agg.byLevel[Number(sel)] || []; if (arr.length) blankStd = std(arr); }
    const lod = computeLODLOQ(fitRes, $('#lodMethod').value, blankStd);

    const slope = fitRes.slope != null ? fitRes.slope : slopeFromFit(fitRes);
    const intercept = fitRes.intercept != null
        ? fitRes.intercept
        : (fitRes.params && typeof fitRes.params.a === 'number' ? fitRes.params.a : 0);
    const seSlope = fitRes.seSlope != null ? fitRes.seSlope : null;
    const seIntercept = fitRes.seIntercept != null ? fitRes.seIntercept : null;
    const r = fitRes.r != null
        ? fitRes.r
        : Math.sign(slope) * Math.sqrt(Math.max(0, fitRes.r2 || 0));

    $('#eqBox').innerHTML = `
      <table class="statsTable">
        <thead>
            <tr><th colspan="2" style="text-align:center">${fitRes.eq || 'Fitted Model'}</th></tr>
        </thead>
        <tbody>
            <tr><td>Slope</td><td>${nice(slope)} ${seSlope != null ? ' ± ' + nice(seSlope) : ''}</td></tr>
            <tr><td>Intercept</td><td>${nice(intercept)} ${seIntercept != null ? ' ± ' + nice(seIntercept) : ''}</td></tr>
            <tr><td>Correlation (r)</td><td>${nice(r)}</td></tr>
            <tr><td>Det. Coeff. (R²)</td><td>${nice(fitRes.r2 || 0)}</td></tr>
            <tr><td>RMSE</td><td>${nice(fitRes.rmse || 0)}</td></tr>
            <tr><td>LOD</td><td>${nice(lod.lod || 0)}</td></tr>
            <tr><td>LOQ (${lod.note})</td><td>${nice(lod.loq || 0)}</td></tr>
        </tbody>
      </table>
    `;
}

/* ===== Calibration exports ===== */
$('#exportCurveCSV').onclick = () => {
    const agg = aggregateLevels();
    const levels = agg.levels;
    if (!levels || levels.length < 2) {
        alert('Need at least two levels to export calibration.');
        return;
    }
    const model = $('#fitModel').value;
    const weighting = $('#weighting').value;
    const fitRes = fitModel(levels, model, weighting);
    if (!fitRes.ok) {
        alert(fitRes.msg || 'Fit not available.');
        return;
    }

    let blankStd = 0;
    const sel = $('#blankLevel').value;
    if (sel && sel !== 'none' && agg.byLevel) {
        const arr = agg.byLevel[Number(sel)] || [];
        if (arr.length) blankStd = std(arr);
    }
    const lod = computeLODLOQ(fitRes, $('#lodMethod').value, blankStd);

    const header = ['Level', 'Y', 'n', 'SD', 'Y_pred', 'Residual'];
    const lines = [header.join(',')];

    levels.forEach(p => {
        const x = p.level;
        const y = p.y;
        const arr = agg.byLevel[x] || [];
        const n = arr.length;
        const sd = n > 1 ? std(arr) : 0;
        let ypred;
        switch (fitRes.model) {
            case 'linear':
                ypred = fitRes.params.a + fitRes.params.b * x;
                break;
            case 'log':
                ypred = fitRes.params.a + fitRes.params.b * Math.log(Math.max(1e-12, x));
                break;
            case 'log10':
                ypred = fitRes.params.a + fitRes.params.b * Math.log10(Math.max(1e-12, x));
                break;
            case 'exp':
                ypred = fitRes.params.a * Math.exp(fitRes.params.b * x);
                break;
            default: {
                const c = fitRes.params.coeff;
                ypred = c.reduce((s, a, j) => s + a * Math.pow(x, j), 0);
            }
        }
        const resid = y - ypred;
        lines.push([
            x,
            y,
            n || '',
            n ? nice(sd) : '',
            nice(ypred),
            nice(resid)
        ].join(','));
    });

    const slope = fitRes.slope != null ? fitRes.slope : slopeFromFit(fitRes);
    const intercept = fitRes.intercept != null
        ? fitRes.intercept
        : (fitRes.params && typeof fitRes.params.a === 'number' ? fitRes.params.a : 0);
    const seSlope = fitRes.seSlope != null ? fitRes.seSlope : '';
    const seIntercept = fitRes.seIntercept != null ? fitRes.seIntercept : '';
    const r = fitRes.r != null
        ? fitRes.r
        : Math.sign(slope) * Math.sqrt(Math.max(0, fitRes.r2 || 0));

    lines.push(''); // Empty line for spacing
    lines.push('--- Parameters ---');
    lines.push(['Model', fitRes.eq || ''].join(','));
    lines.push(['Slope', slope, 'SE_Slope', seSlope].join(','));
    lines.push(['Intercept', intercept, 'SE_Intercept', seIntercept].join(','));
    lines.push(['Correlation (r)', r].join(','));
    lines.push(['R2', fitRes.r2].join(','));
    lines.push(['RMSE', fitRes.rmse].join(','));
    lines.push(['LOD', lod.lod].join(','));
    lines.push(['LOQ', lod.loq].join(','));
    lines.push(['LOQ Method', lod.note].join(','));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chromaeus_calibration.csv';
    a.click();
    URL.revokeObjectURL(a.href);
};

$('#exportCurvePNG').onclick = () => {
    const a = document.createElement('a');
    a.href = chart.toDataURL('image/png');
    a.download = 'chromaeus_calibration.png';
    a.click();
};

/* ===== Measure in drawer ===== */
canvas.addEventListener('click', e => {
    if (!state.calib || !$('#calibDrawer').classList.contains('open')) return;
    const p = clientToImage(e);
    const hit = state.rois.find(r => r.type === 'rect' ? (p.x >= r.geom.x && p.x <= r.geom.x + r.geom.w && p.y >= r.geom.y && p.y <= r.geom.y + r.geom.h)
        : ((p.x - r.geom.cx) ** 2 + (p.y - r.geom.cy) ** 2 <= r.geom.r ** 2));
    const useIdx = $('#useCalib').value; let calib = state.calib.working;
    if (useIdx !== '__current__') { const prof = state.calib.profiles[+useIdx]; if (prof) calib = { ...calib, ...prof.data }; }
    if (!hit) { $('#measureResult').textContent = 'Click a ROI to measure.'; return; }
    const agg = aggregateLevels(); const fitRes = fitModel(agg.levels, $('#fitModel').value, $('#weighting').value);
    if (!fitRes.ok) { $('#measureResult').textContent = 'Fit not available.'; return; }
    const metrics = [...state.measure.metrics];
    const rows = metrics.map(m => {
        const y = metricOf(hit, m); let x = null;
        switch (fitRes.model) {
            case 'linear': { const { a, b } = fitRes.params; x = (y - a) / Math.max(1e-12, b); break; }
            case 'log': { const { a, b } = fitRes.params; x = Math.exp((y - a) / Math.max(1e-12, b)); break; }
            case 'log10': { const { a, b } = fitRes.params; x = Math.pow(10, (y - a) / Math.max(1e-12, b)); break; }
            case 'exp': { const { a, b } = fitRes.params; x = Math.log(Math.max(1e-12, y / Math.max(1e-12, a))) / Math.max(1e-12, b); break; }
            case 'poly2': { const [A, B, C] = fitRes.params.coeff; const aa = C, bb = B, cc = A - y; const disc = bb * bb - 4 * aa * cc; if (disc >= 0) { const r1 = (-bb + Math.sqrt(disc)) / (2 * aa), r2 = (-bb - Math.sqrt(disc)) / (2 * aa); x = [r1, r2].sort((p, q) => Math.abs(p) < Math.abs(q) ? -1 : 1)[0]; } break; }
            case 'poly3': { const c = fitRes.params.coeff, f = X => c.reduce((s, a, j) => s + a * Math.pow(X, j), 0) - y; let lo = 0, hi = Math.max(1, ...agg.levels.map(p => p.level)) * 2; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; f(mid) > 0 ? hi = mid : lo = mid; } x = (lo + hi) / 2; break; }
        }
        return `<tr><td>${m}</td><td style="text-align:right">${nice(y)}</td><td style="text-align:right"><b>${nice(x)}</b> ${state.calib.working.unit}</td></tr>`;
    }).join('');
    $('#measureResult').innerHTML = `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Metric</th><th style="text-align:right">Value</th><th style="text-align:right">Conc</th></tr></thead><tbody>${rows}</tbody></table>`;
});

/* ===== Column UI init ===== */
function renderColUI() { renderColToggles(); renderTable(); }
function rebuildColButtonsFromSpaces() {
    ['R', 'G', 'B', 'H', 'S', 'V', 'L', 'a', 'b', 'C', 'M', 'Y', 'K'].forEach(k => state.tableCols[k] = false);
    state.activeSpaces.forEach(sp => spaceToCols[sp].forEach(k => state.tableCols[k] = true));
    renderColUI();
}
renderColUI();

/* ===== Mouse Events / Magic Wand / Flood Fill Logic ===== */
function magicWand(startX, startY, tolerancePercent) {
    if (!state.off.canvas) return null;
    const W = state.off.canvas.width, H = state.off.canvas.height;
    const ctx = state.off.ctx;
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;

    const idx = (startY * W + startX) * 4;
    const r0 = d[idx], g0 = d[idx+1], b0 = d[idx+2];
    
    const tol = (tolerancePercent / 100) * 255;
    const tolSq = tol * tol;

    function matches(i) {
        const dr = d[i] - r0, dg = d[i+1] - g0, db = d[i+2] - b0;
        return (dr*dr + dg*dg + db*db) <= tolSq; 
    }

    const stack = [[startX, startY]];
    const seen = new Uint8Array(W * H);
    let minX = W, maxX = 0, minY = H, maxY = 0;
    let pixelCount = 0;
    
    while(stack.length) {
        const [x, y] = stack.pop();
        const i = (y * W + x);
        if(seen[i]) continue;
        
        const colorIdx = i * 4;
        if(matches(colorIdx)) {
            seen[i] = 1;
            pixelCount++;
            
            if(x < minX) minX = x;
            if(x > maxX) maxX = x;
            if(y < minY) minY = y;
            if(y > maxY) maxY = y;

            if(x > 0) stack.push([x-1, y]);
            if(x < W-1) stack.push([x+1, y]);
            if(y > 0) stack.push([x, y-1]);
            if(y < H-1) stack.push([x, y+1]);
        }
    }

    if(pixelCount === 0) return null;

    return {
        type: 'rect',
        geom: {
            x: minX,
            y: minY,
            w: (maxX - minX) + 1,
            h: (maxY - minY) + 1
        }
    };
}

canvas.addEventListener('mousedown', e => {
    if (!state.image) return;
    const p = clientToImage(e);

    if (state.tool.mode === 'wand') {
        state.tool.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        return; 
    }

    if (state.tool.areaMode === 'vary') {
        state.tool.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    } else {
        if (!state.tool.fixedPrimed) {
            state.tool.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        } else {
            placeFixedAt(p.x, p.y);
        }
    }
    drawCanvas();
});

canvas.addEventListener('mousemove', e => {
    if (!state.tool.drag) { drawCanvas(); return; }
    const p = clientToImage(e); state.tool.drag.x1 = p.x; state.tool.drag.y1 = p.y; drawCanvas();
});

window.addEventListener('mouseup', () => {
    if(state.tool.mode === 'wand' && state.tool.drag) {
        const {x0, y0} = state.tool.drag;
        state.tool.drag = null;
        drawCanvas();

        const tol = parseInt($('#wandTol').value, 10) || 15;
        const roiSpec = typeof magicWand === 'function' ? magicWand(x0, y0, tol) : null;
        
        if(roiSpec) {
            addROI(roiSpec);
        }
        return;
    }

    if (!state.tool.drag) return;
    const { x0, y0, x1, y1 } = state.tool.drag; 
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    state.tool.drag = null; 
    
    if (w < 3 && h < 3) { drawCanvas(); return; }

    if (state.tool.areaMode === 'vary') {
        let roi; 
        if (state.tool.mode === 'rect') roi = { type: 'rect', geom: { x, y, w, h } }; 
        else { const r = Math.round(Math.min(w, h) / 2); roi = { type: 'circle', geom: { cx: x + w / 2, cy: y + h / 2, r } }; }
        addROI(roi);
    } else {
        if (!state.tool.fixedPrimed) {
            state.tool.fixedSize = { w, h }; state.tool.fixedPrimed = true;
            if (state.tool.mode === 'rect') addROI({ type: 'rect', geom: { x, y, w, h } });
            else { const r = Math.round(Math.min(w, h) / 2); addROI({ type: 'circle', geom: { cx: x + w / 2, cy: y + h / 2, r } }); }
            state.tool.ghost = true; drawCanvas();
        }
    }
});

function placeFixedAt(x, y) {
    let roi;
    if (state.tool.mode === 'rect') { const { w, h } = state.tool.fixedSize; roi = { type: 'rect', geom: { x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h } }; }
    else { const r = Math.floor(Math.min(state.tool.fixedSize.w, state.tool.fixedSize.h) / 2); roi = { type: 'circle', geom: { cx: x, cy: y, r } }; }
    addROI(roi);
}

/* ===== Window hooks ===== */
window.addEventListener('resize', () => { inner.style.transform = `scale(${state.view.zoom})`; drawCanvas(); });

/* ===== Help Menu & Modal Logic ===== */
const helpBtn = $('#helpBtn');
const helpDropdown = $('#helpDropdown');
const modalOverlay = $('#modalOverlay');
const modalClose = $('#modalClose');
const modalTitle = $('#modalTitle');
const modalContent = $('#modalContent');

// 1. Toggle Dropdown
if(helpBtn){
    helpBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent closing immediately
        helpDropdown.classList.toggle('show');
    };
}

// 2. Close Dropdown when clicking outside
window.addEventListener('click', e => {
    if(helpDropdown && !helpDropdown.contains(e.target) && e.target !== helpBtn){
        helpDropdown.classList.remove('show');
    }
});

// 3. Modal Functions
function openModal(title, contentHTML) {
    modalTitle.textContent = title;
    modalContent.innerHTML = contentHTML;
    modalOverlay.classList.add('open');
    helpDropdown.classList.remove('show'); // Close menu
}

function closeModal() {
    modalOverlay.classList.remove('open');
    modalContent.innerHTML = ''; // Clear content (stops video playing)
}

if(modalClose) modalClose.onclick = closeModal;
if(modalOverlay) modalOverlay.onclick = (e) => { if(e.target === modalOverlay) closeModal(); };

// 4. Content Handlers

// A) Image (UI Overview)
$('#linkImg').onclick = () => {
    // Ensure the image file exists in your folder!
    openModal('Interface Overview', '<img src="Help_Chromaeus_UI.png" style="max-width:100%; border-radius:8px; border:1px solid #ccc;">');
};

// B) Videos (Youtube Embeds)
// REPLACE THE 'src' URLS below with your real Youtube Embed Links
$('#linkVidGen').onclick = () => {
    openModal('General Description', `
        <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; max-width:100%;">
            <iframe style="position:absolute; top:0; left:0; width:100%; height:100%;" 
            src="https://www.youtube.com/embed/iQZ8p_STegY" 
            title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
    `);
};

$('#linkVidWork').onclick = () => {
    openModal('Basic Workflow', `
        <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; max-width:100%;">
            <iframe style="position:absolute; top:0; left:0; width:100%; height:100%;" 
            src="https://www.youtube.com/embed/ZWYqV8qw1aY" 
            title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
    `);
};

// C) Citation
$('#linkCite').onclick = () => {
    openModal('How to Cite', `
        <p>If you use Chromaeus in your research, please cite:</p>
        <div class="cite-box">
            Moulahoum, H., et al. (2026). Chromaeus: A Client-Side Web Application for Colorimetric Analysis. <i>Journal Name</i>, Vol(Issue), pp-pp.
        </div>
        <p style="margin-top:10px; font-size:12px; color:#666">Click text to copy (Coming soon)</p>
    `);
};
