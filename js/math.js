/* ===== Math & Color Utilities ===== */

// Basic Helpers
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const std = (a, m = mean(a)) => Math.sqrt(mean(a.map(v => (v - m) * (v - m))));

// Statistics Helpers
const median = a => {
    const s = [...a].sort((x, y) => x - y);
    const n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
}

function trimmedMean(a, p = .1) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const k = Math.floor(p * s.length);
    const m = s.slice(k, s.length - k);
    return mean(m.length ? m : s)
}

function nice(x) {
    return (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0)) ? x.toExponential(3) : (+x.toFixed(4)).toString();
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ===== Color Conversions ===== */
function RGBtoHSV(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max ? d / max : 0;
    const v = max;
    return { h, s, v };
}

function RGBtoLab(r, g, b) {
    function invGamma(u) { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
    const R = invGamma(r), G = invGamma(g), B = invGamma(b);
    const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
    const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
    const Xn = 0.95047, Yn = 1, Zn = 1.08883;
    const fx = f => f > 0.008856 ? Math.cbrt(f) : (7.787 * f + 16 / 116);
    const x = fx(X / Xn), y = fx(Y / Yn), z = fx(Zn ? Z / Zn : 0);
    return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function RGBtoCMYK(r, g, b) {
    const c = 1 - (r / 255), m = 1 - (g / 255), y = 1 - (b / 255);
    const k = Math.min(c, m, y);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 1 };
    return { c: (c - k) / (1 - k), m: (m - k) / (1 - k), y: (y - k) / (1 - k), k };
}

/* ===== Curve Fitting Engine ===== */
function fitModel(levels, model, weighting) {
    const xs = levels.map(p => p.level), ys = levels.map(p => p.y), ws = levels.map(p => {
        if (weighting === 'invY') return 1 / Math.max(1e-9, p.y);
        if (weighting === 'invY2') return 1 / Math.max(1e-9, p.y * p.y);
        return 1;
    });
    if (xs.length < 2) return { ok: false, msg: 'Need ≥ 2 levels' };

    function sumsq(a) { return a.reduce((s, v) => s + v * v, 0) }

    function linfit(x, y, w) {
        const n = x.length;
        let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, Syy = 0;
        for (let i = 0; i < n; i++) {
            const wi = w[i], xi = x[i], yi = y[i];
            Sw += wi; Sx += wi * xi; Sy += wi * yi; Sxx += wi * xi * xi; Sxy += wi * xi * yi; Syy += wi * yi * yi;
        }
        const den = (Sw * Sxx - Sx * Sx) || 1e-12;
        const a = (Sy * Sxx - Sx * Sxy) / den;
        const b = (Sw * Sxy - Sx * Sy) / den;
        const yhat = x.map(xi => a + b * xi);
        const resid = y.map((yi, i) => yi - yhat[i]);
        const ybar = mean(y);
        const SSE = resid.reduce((s, e) => s + e * e, 0);
        const SST = y.reduce((s, yi) => { const d = yi - ybar; return s + d * d; }, 0) || 1e-12;
        const r2 = 1 - SSE / SST;
        const dof = Math.max(1, n - 2);
        const rmse = Math.sqrt(SSE / dof);
        const sigma2 = SSE / dof;
        const seIntercept = Math.sqrt(sigma2 * Sxx / den);
        const seSlope = Math.sqrt(sigma2 * Sw / den);
        const r = Math.sign(b) * Math.sqrt(Math.max(0, r2));
        return {
            params: { a, b }, yhat, resid, r2, rmse, eq: `y = ${nice(a)} + ${nice(b)} x`,
            seSlope, seIntercept, r, slope: b, intercept: a
        };
    }

    function polyfit(x, y, deg, w) {
        const m = deg + 1; const A = Array.from({ length: m }, () => Array(m).fill(0)); const B = Array(m).fill(0);
        for (let i = 0; i < x.length; i++) { const wi = w[i], xi = x[i], yi = y[i]; for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) { A[r][c] += wi * Math.pow(xi, r + c); } B[r] += wi * yi * Math.pow(xi, r); } }
        const coeff = solve(A, B); const yhat = x.map(xi => coeff.reduce((s, a, j) => s + a * Math.pow(xi, j), 0)); const resid = y.map((yi, i) => yi - yhat[i]); const r2 = 1 - (sumsq(resid) / (sumsq(y.map(v => v - mean(y))) || 1e-12)); const rmse = Math.sqrt(mean(resid.map(e => e * e)));
        return { params: { coeff }, yhat, resid, r2, rmse, eq: `y = ` + coeff.map((a, j) => `${nice(a)}${j ? ` x^${j}` : ''}`).join(' + ') };
    }

    function logfit(x, y, w) {
        const tx = [], ty = [], tw = [];
        for (let i = 0; i < x.length; i++) {
            const xi = x[i];
            if (xi > 0 && isFinite(xi)) { tx.push(Math.log(xi)); ty.push(y[i]); tw.push(w[i]); }
        }
        if (tx.length < 2) return { ok: false, msg: 'Need ≥ 2 positive x values for log fit' };
        const res = linfit(tx, ty, tw);
        res.eq = `y = ${nice(res.params.a)} + ${nice(res.params.b)} ln(x)`;
        return res;
    }

    function log10fit(x, y, w) {
        const tx = [], ty = [], tw = [];
        for (let i = 0; i < x.length; i++) {
            const xi = x[i];
            if (xi > 0 && isFinite(xi)) { tx.push(Math.log10(xi)); ty.push(y[i]); tw.push(w[i]); }
        }
        if (tx.length < 2) return { ok: false, msg: 'Need ≥ 2 positive x values for log₁₀ fit' };
        const res = linfit(tx, ty, tw);
        res.eq = `y = ${nice(res.params.a)} + ${nice(res.params.b)} log₁₀(x)`;
        return res;
    }

    function expfit(x, y, w) { const yl = y.map(v => Math.log(Math.max(1e-12, v))); const res = linfit(x, yl, w); const a = Math.exp(res.params.a), b = res.params.b; const yhat = x.map(xi => a * Math.exp(b * xi)); const resid = y.map((yi, i) => yi - yhat[i]); const r2 = 1 - (sumsq(resid) / (sumsq(y.map(v => v - mean(y))) || 1e-12)); const rmse = Math.sqrt(mean(resid.map(e => e * e))); return { params: { a, b }, yhat, resid, r2, rmse, eq: `y = ${nice(a)} · e^{${nice(b)}x}` }; }

    function solve(A, B) { const n = B.length; A = A.map(r => r.slice()); B = B.slice(); for (let i = 0; i < n; i++) { let max = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r; if (max !== i) { [A[i], A[max]] = [A[max], A[i]];[B[i], B[max]] = [B[max], B[i]]; } const d = A[i][i] || 1e-12; for (let c = i; c < n; c++) A[i][c] /= d; B[i] /= d; for (let r = 0; r < n; r++) { if (r === i) continue; const f = A[r][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; B[r] -= f * B[i]; } } return B; }

    switch (model) {
        case 'linear': return { ok: true, model: 'linear', ...linfit(xs, ys, ws) };
        case 'log': { const res = logfit(xs, ys, ws); return res.ok === false ? res : { ok: true, model: 'log', ...res }; }
        case 'log10': { const res = log10fit(xs, ys, ws); return res.ok === false ? res : { ok: true, model: 'log10', ...res }; }
        case 'exp': return { ok: true, model: 'exp', ...expfit(xs, ys, ws) };
        case 'poly2': return { ok: true, model: 'poly2', ...polyfit(xs, ys, 2, ws) };
        case 'poly3': return { ok: true, model: 'poly3', ...polyfit(xs, ys, 3, ws) };
        default: return { ok: false, msg: 'Model not implemented' };
    }
}

function slopeFromFit(f) {
    if (f.model === 'linear') return f.params.b;
    if (f.model === 'poly2') { const [a, b, c] = f.params.coeff; return b; }
    if (f.model === 'poly3') { const [a, b, c, d] = f.params.coeff; return b; }
    if (f.model === 'log') return f.params.b;
    if (f.model === 'log10') return f.params.b;
    if (f.model === 'exp') { return f.params.a * f.params.b; }
    return 1;
}

function computeLODLOQ(fitRes, method, blankStd) {
    const slope = Math.max(1e-12, Math.abs(slopeFromFit(fitRes)));
    if (method === 'resid') { const sigma = fitRes.rmse || 0; return { lod: 3.3 * sigma / slope, loq: 10 * sigma / slope, note: 'Residual-based' }; }
    if (method === 'blank') { const sigma = blankStd || 0; return { lod: 3.3 * sigma / slope, loq: 10 * sigma / slope, note: 'Blank-based' }; }
    const A = computeLODLOQ(fitRes, 'blank', blankStd);
    return { lod: A.lod, loq: A.loq, note: `Both (blank shown)` };
}