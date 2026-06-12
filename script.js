// ==================== SPOTIFY SDK GLOBAL CALLBACK ====================
window.onSpotifyWebPlaybackSDKReady = () => {
    console.log("Spotify SDK ready");
    if (window.spotifyToken && !window.spotifyPlayer) {
        initSpotifyPlayerInternal();
    }
};

// ==================== IMPORTAÇÕES ====================
import {
    collection, addDoc, getDocs, query, orderBy,
    doc, getDoc, setDoc, where, deleteDoc, updateDoc,
    onSnapshot, limit, startAfter
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const db = window.db;
if (!db) console.error("❌ Firestore não inicializado!");

// ==================== CONSTANTES ====================
const DATA_INICIO   = new Date(2025, 7, 11, 21, 46, 0);
const IMGBB_API_KEY = "6fb524bd462f38196629ff83d4b594fa";
const PAGE_SIZE     = 12;

const avaliacaoImgs = {
    1: "https://i.ibb.co/QjQdgswz/download-9.jpg",
    2: "https://i.ibb.co/B57j8S4F/images-4.jpg",
    3: "https://i.ibb.co/V1Y71LQ/4250574.png",
    4: "https://i.ibb.co/TxLjwPHx/happy-cat-dance-hapi-cute-260nw-2308472719.webp",
    5: "https://i.ibb.co/RkTMbKG3/absolute-pompompurin.png"
};

// ==================== ESTADO GLOBAL ====================
let usuarioAtual    = null;
let categoriaAtual  = "nossos-meses";
let modoSurpresa    = false;

let seriesList, adicionarSerieBtn;
let viagensList, adicionarViagemBtn;
let albumGrid, botoesCategoria, adicionarFotoBtn, carregarMaisBtn, ordenacaoAlbum, filtroData;
let timelineList, adicionarTimelineBtn;
let metasList, adicionarMetaBtn;

let audioPlayer = null, musicPlaying = false;
let mapa = null, mapaInicializado = false, rotaControl = null;
let currentMarkers = [];
let debounceTimeout = null;
let unsubscribeNotificacoes = null, unsubscribeChat = null;
let calendar = null;
let charts = {};

// Paginação do álbum
let ultimoDocFoto     = null;
let todasFotosCache   = [];

// Lightbox
let fotoUrlsLightbox  = [];
let lightboxIndex     = 0;

// ==================== CONFIGURAÇÕES SPOTIFY ====================
const SPOTIFY_CLIENT_ID    = '888a34e34c574abea2a14a0392be64bd';
const SPOTIFY_REDIRECT_URI = window.location.href.split('?')[0];
const SPOTIFY_SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state'
].join(' ');

let spotifyToken    = null;
let spotifyDeviceId = null;
let spotifyPlayer   = null;

window.spotifyToken  = null;
window.spotifyPlayer = null;

// ==================== SPOTIFY: PKCE ====================
function generateCodeVerifier(length = 128) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    return Array.from({ length }, () => possible[Math.floor(Math.random() * possible.length)]).join('');
}

async function generateCodeChallenge(codeVerifier) {
    const data   = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function exchangeCodeForToken(code, codeVerifier) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code, redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: SPOTIFY_CLIENT_ID, code_verifier: codeVerifier
    });
    const res  = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const data = await res.json();
    if (data.access_token) {
        localStorage.setItem('spotify_token', data.access_token);
        if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
        window.location.href = SPOTIFY_REDIRECT_URI;
    } else {
        console.error('Erro ao obter token Spotify:', data);
        alert('Falha na autenticação do Spotify. Tente novamente.');
    }
}

function getSpotifyTokenFromURL() {
    const urlParams     = new URLSearchParams(window.location.search);
    const code          = urlParams.get('code');
    const savedVerifier = localStorage.getItem('spotify_code_verifier');
    if (code && savedVerifier) {
        exchangeCodeForToken(code, savedVerifier);
        localStorage.removeItem('spotify_code_verifier');
        return null;
    }
    return localStorage.getItem('spotify_token');
}

function redirectToSpotifyLogin() {
    const codeVerifier = generateCodeVerifier();
    localStorage.setItem('spotify_code_verifier', codeVerifier);
    generateCodeChallenge(codeVerifier).then(codeChallenge => {
        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.searchParams.append('client_id', SPOTIFY_CLIENT_ID);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('redirect_uri', SPOTIFY_REDIRECT_URI);
        authUrl.searchParams.append('code_challenge_method', 'S256');
        authUrl.searchParams.append('code_challenge', codeChallenge);
        authUrl.searchParams.append('scope', SPOTIFY_SCOPES);
        window.location.href = authUrl.toString();
    });
}

// ==================== SPOTIFY: API ====================
async function spotifyFetch(endpoint, options = {}) {
    if (!spotifyToken) throw new Error('Não autenticado no Spotify');
    const res = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${spotifyToken}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!res.ok) {
        if (res.status === 401) {
            localStorage.removeItem('spotify_token');
            spotifyToken = null;
            window.location.reload();
        }
        throw new Error(`Spotify API ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

// ==================== SPOTIFY: PLAYER ====================
function updateSpotifyDeviceStatus(msg) {
    const el = document.getElementById('spotifyDeviceStatus');
    if (el) el.innerHTML = msg;
}

function initSpotifyPlayerInternal() {
    if (!spotifyToken || spotifyPlayer) return;
    spotifyPlayer = new Spotify.Player({
        name: 'Nosso Tempo Player',
        getOAuthToken: cb => cb(spotifyToken),
        volume: 0.5
    });
    spotifyPlayer.addListener('ready', ({ device_id }) => {
        spotifyDeviceId = device_id;
        updateSpotifyDeviceStatus('✅ Dispositivo conectado!');
        spotifyFetch('me/player', {
            method: 'PUT',
            body: JSON.stringify({ device_ids: [device_id], play: false })
        }).catch(() => {});
    });
    spotifyPlayer.addListener('player_state_changed', state => {
        const el = document.getElementById('spotifyNowPlaying');
        if (!el) return;
        if (state) {
            const t = state.track_window.current_track;
            el.innerHTML = `🎵 Tocando: <strong>${escapeHtml(t.name)}</strong> — ${t.artists.map(a => escapeHtml(a.name)).join(', ')}`;
        } else {
            el.textContent = 'Nada tocando no momento';
        }
    });
    spotifyPlayer.addListener('not_ready', () => updateSpotifyDeviceStatus('⚠️ Dispositivo desconectado'));
    spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('Spotify init error:', message);
        updateSpotifyDeviceStatus('❌ Erro na inicialização');
    });
    spotifyPlayer.addListener('authentication_error', () => {
        localStorage.removeItem('spotify_token');
        window.location.reload();
    });
    spotifyPlayer.connect();
    window.spotifyPlayer = spotifyPlayer;
}

async function transferPlaybackHere() {
    if (!spotifyDeviceId || !spotifyToken) return;
    await spotifyFetch('me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [spotifyDeviceId], play: false })
    }).catch(() => {});
}

// ==================== SPOTIFY: CONTROLES ====================
async function spotifyPlay(uri) {
    if (!spotifyDeviceId) return;
    await transferPlaybackHere();
    const body = uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri };
    await spotifyFetch(`me/player/play?device_id=${spotifyDeviceId}`, { method: 'PUT', body: JSON.stringify(body) });
}

async function spotifyTogglePlay() {
    if (!spotifyDeviceId) return;
    const state = await spotifyFetch('me/player').catch(() => null);
    if (state?.is_playing) {
        await spotifyFetch('me/player/pause', { method: 'PUT' });
    } else {
        await transferPlaybackHere();
        await spotifyFetch('me/player/play', { method: 'PUT' });
    }
}

async function spotifyNext()     { await spotifyFetch('me/player/next',     { method: 'POST' }).catch(() => {}); }
async function spotifyPrevious() { await spotifyFetch('me/player/previous', { method: 'POST' }).catch(() => {}); }
async function spotifySetVolume(v) {
    if (!spotifyDeviceId) return;
    await spotifyFetch(`me/player/volume?volume_percent=${Math.round(v * 100)}&device_id=${spotifyDeviceId}`, { method: 'PUT' }).catch(() => {});
}

// ==================== SPOTIFY: BUSCA ====================
async function spotifySearch(q) {
    if (!q.trim()) return;
    const resultsDiv = document.getElementById('spotifySearchResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '<p class="loading-text">🔍 Buscando...</p>';
    try {
        const data = await spotifyFetch(`search?q=${encodeURIComponent(q)}&type=track,artist,playlist&limit=20`);
        let html = '';
        if (data.tracks?.items.length) {
            html += `<h3>🎵 Músicas</h3><div class="grid-cards">`;
            data.tracks.items.forEach(track => {
                html += `<div class="card" data-uri="${track.uri}" data-type="track">
                    <img src="${track.album.images[0]?.url || 'https://placehold.co/200x200'}" loading="lazy">
                    <div class="card-content">
                        <h3>${escapeHtml(track.name)}</h3>
                        <p>${track.artists.map(a => escapeHtml(a.name)).join(', ')}</p>
                        <button class="play-spotify-btn btn-admin">▶️ Tocar</button>
                    </div></div>`;
            });
            html += `</div>`;
        }
        if (data.artists?.items.length) {
            html += `<h3>🎤 Artistas</h3><div class="grid-cards">`;
            data.artists.items.forEach(artist => {
                html += `<div class="card" data-uri="${artist.uri}" data-type="artist">
                    <img src="${artist.images[0]?.url || 'https://placehold.co/200x200'}" loading="lazy">
                    <div class="card-content">
                        <h3>${escapeHtml(artist.name)}</h3>
                        <button class="play-spotify-btn btn-admin">▶️ Tocar (Top 10)</button>
                    </div></div>`;
            });
            html += `</div>`;
        }
        if (data.playlists?.items.length) {
            html += `<h3>📀 Playlists</h3><div class="grid-cards">`;
            data.playlists.items.forEach(pl => {
                html += `<div class="card" data-uri="${pl.uri}" data-type="playlist">
                    <img src="${pl.images[0]?.url || 'https://placehold.co/200x200'}" loading="lazy">
                    <div class="card-content">
                        <h3>${escapeHtml(pl.name)}</h3>
                        <p>${escapeHtml(pl.description || '')}</p>
                        <button class="play-spotify-btn btn-admin">▶️ Tocar playlist</button>
                    </div></div>`;
            });
            html += `</div>`;
        }
        resultsDiv.innerHTML = html || '<p>Nenhum resultado encontrado.</p>';
        resultsDiv.querySelectorAll('.play-spotify-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const card = btn.closest('.card');
                const uri  = card.dataset.uri;
                if (card.dataset.type === 'artist') {
                    const artistId  = uri.split(':')[2];
                    const topTracks = await spotifyFetch(`artists/${artistId}/top-tracks?market=BR`).catch(() => null);
                    if (topTracks?.tracks?.length) await spotifyPlay(topTracks.tracks[0].uri);
                } else {
                    await spotifyPlay(uri);
                }
            });
        });
    } catch (err) {
        console.error('Spotify search error:', err);
        resultsDiv.innerHTML = '<p>❌ Erro ao buscar. Tente novamente.</p>';
    }
}

// ==================== SPOTIFY: INICIALIZAÇÃO ====================
function setupSpotifyControls() {
    const loginBtn     = document.getElementById('loginSpotifyBtn');
    const searchBtn    = document.getElementById('spotifySearchBtn');
    const searchInput  = document.getElementById('spotifySearchInput');
    const playPauseBtn = document.getElementById('spotifyPlayPauseBtn');
    const nextBtn      = document.getElementById('spotifyNextBtn');
    const prevBtn      = document.getElementById('spotifyPrevBtn');
    const volSlider    = document.getElementById('spotifyVolumeSlider');
    const volIcon      = document.getElementById('spotifyVolumeIcon');

    if (loginBtn) loginBtn.onclick = () => redirectToSpotifyLogin();
    if (!spotifyToken) return;

    if (searchBtn)   searchBtn.onclick   = () => spotifySearch(searchInput?.value || '');
    if (searchInput) searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') spotifySearch(e.target.value); });
    if (playPauseBtn) playPauseBtn.onclick = () => spotifyTogglePlay();
    if (nextBtn)     nextBtn.onclick     = () => spotifyNext();
    if (prevBtn)     prevBtn.onclick     = () => spotifyPrevious();
    if (volSlider)   volSlider.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        spotifySetVolume(v);
        if (volIcon) volIcon.textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
    });
}

function initSpotify() {
    spotifyToken        = getSpotifyTokenFromURL();
    window.spotifyToken = spotifyToken;
    const loginDiv        = document.getElementById('spotifyLoginDiv');
    const playerContainer = document.getElementById('spotifyPlayerContainer');
    setupSpotifyControls();
    if (spotifyToken) {
        if (loginDiv)        loginDiv.style.display = 'none';
        if (playerContainer) playerContainer.style.display = 'block';
        if (typeof Spotify !== 'undefined' && Spotify.Player) initSpotifyPlayerInternal();
    } else {
        if (loginDiv)        loginDiv.style.display = 'block';
        if (playerContainer) playerContainer.style.display = 'none';
    }
}

// ==================== GOOGLE DRIVE ====================
const GOOGLE_CLIENT_ID = '241579865765-ak7eabusfoqi5fp639ts6n5umn17rsva.apps.googleusercontent.com';
const GOOGLE_API_KEY   = 'AIzaSyAtieN3l5st6DQoRBIiYyTe4ERAXzuBpXE';
const GOOGLE_APP_ID    = '241579865765';
const GOOGLE_SCOPES    = 'https://www.googleapis.com/auth/drive.readonly';

let tokenClient = null, accessToken = null;
let gapiInited  = false, gisInited  = false;

function initTokenClient() {
    if (tokenClient) return;
    if (typeof google === 'undefined' || !google.accounts?.oauth2) { setTimeout(initTokenClient, 200); return; }
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: ''
    });
    gisInited = true;
}

function initGapi() {
    if (typeof gapi === 'undefined') { setTimeout(initGapi, 200); return; }
    gapi.load('client:picker', async () => {
        await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');
        gapiInited = true;
    });
}

function handleGoogleDriveAuth() {
    if (!tokenClient) { alert("APIs do Google ainda carregando. Tente em 2 segundos."); return; }
    if (accessToken === null) {
        tokenClient.callback = async res => {
            if (res.error) { alert("Erro ao autenticar com o Google."); return; }
            accessToken = res.access_token;
            createPicker();
        };
        tokenClient.requestAccessToken();
    } else {
        createPicker();
    }
}

async function createPicker() {
    if (!accessToken || !gapiInited) { setTimeout(createPicker, 500); return; }
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes("image/jpeg,image/png,image/gif,image/webp,image/bmp");
    new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setAppId(GOOGLE_APP_ID)
        .setOAuthToken(accessToken)
        .addView(view)
        .addView(new google.picker.DocsUploadView())
        .setCallback(pickerCallback)
        .build()
        .setVisible(true);
}

async function pickerCallback(data) {
    if (data.action !== google.picker.Action.PICKED) return;
    const statusDiv = document.getElementById('importStatus');
    if (statusDiv) statusDiv.textContent = "⏳ Importando...";
    let errors = 0;
    for (const d of data.docs) {
        try {
            const res  = await fetch(`https://www.googleapis.com/drive/v3/files/${d.id}?alt=media`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) throw new Error(`Erro ao baixar ${d.name}`);
            const blob = await res.blob();
            const file = new File([blob], d.name, { type: blob.type });
            const url  = await uploadParaImgBB(file);
            await addDoc(collection(db, 'fotos'), {
                categoria: categoriaAtual, url,
                legenda: `Drive: ${d.name}`,
                dataEnvio: new Date(), enviadoPor: usuarioAtual, tipo: 'image'
            });
        } catch (err) {
            console.error(err);
            errors++;
        }
    }
    carregarFotos(categoriaAtual, true);
    iniciarSlideshow();
    if (statusDiv) statusDiv.textContent = errors ? `⚠️ ${errors} erro(s) na importação.` : "✅ Importação concluída!";
    fecharModal('modal');
}

function exibirModalImportar() {
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;
    modalBody.innerHTML = `
        <h2>📥 Importar fotos</h2>
        <p style="margin-bottom:1rem;">Selecione a origem:</p>
        <button id="importGoogleDriveBtn" class="btn-admin">📁 Google Drive</button>
        <button id="importInstagramBtn"   class="btn-admin">📸 Instagram (em breve)</button>
        <div id="importStatus" style="margin-top:1rem;"></div>
    `;
    abrirModal('modal');
    document.getElementById('importGoogleDriveBtn').onclick = handleGoogleDriveAuth;
    document.getElementById('importInstagramBtn').onclick   = () => {
        document.getElementById('importStatus').textContent = "⚠️ Instagram ainda não integrado.";
    };
}

// ==================== MODO SURPRESA ====================
function alternarModoSurpresa() {
    modoSurpresa = !modoSurpresa;
    document.body.classList.toggle('modo-surpresa', modoSurpresa);
    if (modoSurpresa) {
        const anos = Math.floor((Date.now() - DATA_INICIO) / (1000 * 60 * 60 * 24 * 365));
        document.querySelector('.contador')?.setAttribute('data-anos', anos);
    }
    localStorage.setItem('modoSurpresa', modoSurpresa);
}

// ==================== UTILITÁRIOS ====================
async function uploadParaImgBB(file) {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('key', IMGBB_API_KEY);
    const res  = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) return data.data.url;
    throw new Error('ImgBB: ' + data.error.message);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
    );
}

// FIX #5: fecharModal agora recebe o id do modal específico, ou fecha todos
function fecharModal(modalId) {
    if (modalId) {
        const el = document.getElementById(modalId);
        if (el) el.style.display = 'none';
        return;
    }
    // Fecha todos os modais visíveis
    ['modal', 'lightboxModal', 'modalDetalhesEvento', 'modalMapa'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function abrirModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
}

function formatarDataBR(dataString) {
    if (!dataString) return 'Data não definida';
    const d = new Date(dataString + 'T00:00:00');
    if (isNaN(d)) return dataString;
    return d.toLocaleDateString('pt-BR');
}

async function buscarSugestoesLocal(termo) {
    if (!termo || termo.length < 2) return [];
    try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}&limit=5&accept-language=pt`);
        const data = await res.json();
        return data.map(i => i.display_name);
    } catch { return []; }
}

async function obterCoordenadas(endereco) {
    try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endereco)}&limit=1`);
        const data = await res.json();
        if (data?.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        return null;
    } catch { return null; }
}

async function salvarPreferencias() {
    if (!usuarioAtual) return;
    await setDoc(doc(db, 'preferencias', usuarioAtual), {
        tema: document.getElementById('temaCorSelect')?.value || 'rosa',
        ordenacao: document.getElementById('ordenacaoAlbum')?.value || 'recente'
    });
}

async function carregarPreferencias() {
    if (!usuarioAtual) return;
    const snap = await getDoc(doc(db, 'preferencias', usuarioAtual));
    if (snap.exists()) {
        const p = snap.data();
        if (document.getElementById('temaCorSelect')) document.getElementById('temaCorSelect').value = p.tema || 'rosa';
        if (document.getElementById('ordenacaoAlbum')) document.getElementById('ordenacaoAlbum').value = p.ordenacao || 'recente';
        aplicarTema(p.tema || 'rosa');
    }
}

function aplicarTema(cor) {
    document.body.classList.remove('tema-rosa', 'tema-roxo', 'tema-azul');
    document.body.classList.add(`tema-${cor}`);
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function compartilharLink() {
    navigator.clipboard.writeText(window.location.href);
    alert("Link copiado! 💕");
}

// ==================== CHAT ====================
function iniciarChat() {
    if (!usuarioAtual) return;
    if (unsubscribeChat) unsubscribeChat();
    unsubscribeChat = onSnapshot(
        query(collection(db, 'mensagens'), orderBy('timestamp', 'asc')),
        snap => {
            const container = document.getElementById('chatMessages');
            if (!container) return;
            container.innerHTML = '';
            snap.forEach(d => {
                const m   = d.data();
                const div = document.createElement('div');
                div.className = `chat-mensagem ${m.autor}`;
                div.innerHTML = `<strong>${m.autor === 'alexandre' ? 'Alexandre' : 'Ana'}</strong><br>
                    ${escapeHtml(m.texto)}<br>
                    <small>${m.timestamp?.toDate().toLocaleTimeString()}</small>`;
                container.appendChild(div);
            });
            container.scrollTop = container.scrollHeight;
        }
    );
}

async function enviarMensagem(texto) {
    if (!texto.trim() || !usuarioAtual) return;
    await addDoc(collection(db, 'mensagens'), {
        texto: texto.trim(), autor: usuarioAtual, timestamp: new Date()
    });
}

// ==================== ESTATÍSTICAS ====================
async function carregarEvolucao() {
    const snap  = await getDocs(collection(db, 'fotos'));
    const meses = {};
    snap.forEach(d => {
        const dt = d.data().dataEnvio?.toDate();
        if (dt) {
            const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
            meses[k] = (meses[k] || 0) + 1;
        }
    });
    const labels = Object.keys(meses).sort();
    const ctx    = document.getElementById('evolucaoChart')?.getContext('2d');
    if (ctx) {
        if (charts.evolucao) charts.evolucao.destroy();
        charts.evolucao = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Fotos/mês', data: labels.map(l => meses[l]), borderColor: '#b83b5e', tension: 0.3, fill: true, backgroundColor: 'rgba(184,59,94,0.1)' }] }
        });
    }
}

async function carregarEstatisticas() {
    const fotosSnap  = await getDocs(collection(db, 'fotos'));
    const categorias = {};
    fotosSnap.forEach(d => { const c = d.data().categoria; categorias[c] = (categorias[c] || 0) + 1; });

    const ctxFotos = document.getElementById('fotosPorCategoriaChart')?.getContext('2d');
    if (ctxFotos) {
        if (charts.fotosChart) charts.fotosChart.destroy();
        charts.fotosChart = new Chart(ctxFotos, {
            type: 'bar',
            data: { labels: Object.keys(categorias), datasets: [{ label: 'Fotos', data: Object.values(categorias), backgroundColor: '#b83b5e' }] }
        });
    }

    const metasSnap = await getDocs(collection(db, 'metas'));
    let [concluidas, pendentes] = [0, 0];
    metasSnap.forEach(d => d.data().concluida ? concluidas++ : pendentes++);
    const ctxMetas = document.getElementById('metasStatusChart')?.getContext('2d');
    if (ctxMetas) {
        if (charts.metasChart) charts.metasChart.destroy();
        charts.metasChart = new Chart(ctxMetas, {
            type: 'pie',
            data: { labels: ['Concluídas', 'Pendentes'], datasets: [{ data: [concluidas, pendentes], backgroundColor: ['#2ecc71', '#e74c3c'] }] }
        });
    }

    const seriesSnap = await getDocs(collection(db, 'series'));
    let [seriesCount, filmesCount] = [0, 0];
    seriesSnap.forEach(d => d.data().tipo === 'serie' ? seriesCount++ : filmesCount++);
    const ctxSeries = document.getElementById('seriesTipoChart')?.getContext('2d');
    if (ctxSeries) {
        if (charts.seriesChart) charts.seriesChart.destroy();
        charts.seriesChart = new Chart(ctxSeries, {
            type: 'doughnut',
            data: { labels: ['Séries', 'Filmes'], datasets: [{ data: [seriesCount, filmesCount], backgroundColor: ['#3498db', '#f1c40f'] }] }
        });
    }

    const viagensPlanejadasSnap = await getDocs(query(collection(db, 'viagens'), where('status', '==', 'planejada')));
    const timelineSnap = await getDocs(collection(db, 'timeline'));
    const resumoDiv    = document.getElementById('resumoEstatisticas');
    if (resumoDiv) {
        resumoDiv.innerHTML = `
            <p>📸 Total de fotos: <strong>${fotosSnap.size}</strong></p>
            <p>🎯 Metas concluídas: <strong>${concluidas} / ${concluidas + pendentes}</strong></p>
            <p>🎬 Séries/filmes: <strong>${seriesCount + filmesCount}</strong></p>
            <p>✈️ Viagens planejadas: <strong>${viagensPlanejadasSnap.size}</strong></p>
            <p>📅 Eventos na linha do tempo: <strong>${timelineSnap.size}</strong></p>
        `;
    }
    await carregarEvolucao();
}

// ==================== NOTIFICAÇÕES ====================
async function criarNotificacao(tipo, entidadeId, entidadeNome, acao) {
    if (!usuarioAtual) return;
    await addDoc(collection(db, 'notificacoes'), {
        tipo, entidadeId, entidadeNome, acao,
        autor: usuarioAtual,
        destinatario: usuarioAtual === 'alexandre' ? 'ana' : 'alexandre',
        data: new Date(), lida: false
    }).catch(() => {});
}

function iniciarObservadorNotificacoes() {
    if (!usuarioAtual) return;
    if (unsubscribeNotificacoes) unsubscribeNotificacoes();
    const q = query(collection(db, 'notificacoes'), where('destinatario', '==', usuarioAtual), orderBy('data', 'desc'));
    unsubscribeNotificacoes = onSnapshot(q, snap => {
        const badge    = document.getElementById('notificacaoBadge');
        if (!badge) return;
        const naoLidas = snap.docs.filter(d => !d.data().lida).length;
        badge.textContent    = naoLidas;
        badge.style.display  = naoLidas > 0 ? 'inline-block' : 'none';
    }, err => { console.error("Notificações observer:", err); });
}

async function carregarNotificacoesNaoLidas() {
    if (!usuarioAtual) return;
    const q    = query(collection(db, 'notificacoes'), where('destinatario', '==', usuarioAtual), where('lida', '==', false));
    const snap = await getDocs(q);
    const badge = document.getElementById('notificacaoBadge');
    if (badge) { badge.textContent = snap.size; badge.style.display = snap.size > 0 ? 'inline-block' : 'none'; }
}

async function exibirListaNotificacoes() {
    if (!usuarioAtual) return;
    const q    = query(collection(db, 'notificacoes'), where('destinatario', '==', usuarioAtual), orderBy('data', 'desc'));
    const snap = await getDocs(q);
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;

    let html = '<h2>🔔 Notificações</h2><div class="notificacao-lista" style="position:static;width:100%;">';
    if (snap.empty) html += '<p>Nenhuma notificação.</p>';
    snap.forEach(d => {
        const n = d.data();
        html += `<div class="notificacao-item ${n.lida ? '' : 'nao-lida'}" data-id="${d.id}">
            <strong>${n.autor === 'alexandre' ? 'Alexandre' : 'Ana'}</strong> ${n.acao} "${escapeHtml(n.entidadeNome)}"
            <br><small>${n.data?.toDate().toLocaleString()}</small>
        </div>`;
    });
    html += '</div><button id="marcarTodasLidas" class="btn-admin">✅ Marcar todas como lidas</button>';
    modalBody.innerHTML = html;
    abrirModal('modal');

    modalBody.querySelectorAll('.notificacao-item').forEach(el => {
        el.addEventListener('click', async () => {
            await updateDoc(doc(db, 'notificacoes', el.dataset.id), { lida: true });
            exibirListaNotificacoes();
        });
    });
    document.getElementById('marcarTodasLidas')?.addEventListener('click', async () => {
        await Promise.all(snap.docs.map(d => updateDoc(doc(db, 'notificacoes', d.id), { lida: true })));
        exibirListaNotificacoes();
    });
}

// ==================== COMPARTILHAR / BACKUP ====================
async function compartilharAvancado() {
    try {
        const fotosSnap = await getDocs(collection(db, 'fotos'));
        const fotos     = fotosSnap.docs.map(d => d.data().url).filter(u => u && !u.includes('placehold'));
        const canvas    = document.createElement('canvas');
        canvas.width  = 800; canvas.height = 600;
        const ctx     = canvas.getContext('2d');
        ctx.fillStyle = '#fde4e8';
        ctx.fillRect(0, 0, 800, 600);

        if (fotos.length) {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            await new Promise(res => {
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, 800, 600);
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(0, 0, 800, 600);
                    res();
                };
                img.onerror = res;
                img.src = fotos[Math.floor(Math.random() * fotos.length)];
            });
        }

        ctx.font = 'bold 40px serif'; ctx.fillStyle = '#fff';
        ctx.fillText('✨ Nosso Tempo ✨', 200, 100);
        ctx.font = '30px sans-serif';
        ctx.fillText(`Juntos há ${document.getElementById('meses')?.textContent || '0'} meses`, 220, 200);

        const link      = document.createElement('a');
        link.download   = 'nosso-tempo.png';
        link.href       = canvas.toDataURL('image/png');
        link.click();
        alert("Imagem salva! 💕");
    } catch { alert("Erro ao gerar imagem."); }
}

async function exportarBackup() {
    if (!usuarioAtual) return;
    const colecoes = ['fotos','series','episodios','avaliacoes','comentarios','viagens','locais','fotosViagens','metas','timeline','datasEspeciais','notificacoes','mensagens','preferencias'];
    const backup   = {};
    for (const c of colecoes) {
        const snap = await getDocs(collection(db, c));
        backup[c]  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `backup_${usuarioAtual}_${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    alert("Backup exportado!");
}

// ==================== BUSCA GLOBAL ====================
function realizarBuscaGlobal(termo) {
    if (!termo || termo.length < 2) {
        carregarFotos(categoriaAtual, true);
        return;
    }
    const t = termo.toLowerCase();
    const filtrar = sel => document.querySelectorAll(sel).forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(t) ? '' : 'none';
    });
    filtrar('#albumGrid .card');
    filtrar('#listaSeries .card');
    filtrar('#listaViagens .card');
    filtrar('#listaMetas .card');
    filtrar('#listaTimeline .timeline-card');
}

// ==================== LIGHTBOX ====================
function abrirLightbox(fotosArray, index) {
    fotoUrlsLightbox = fotosArray.filter(f => f.tipo !== 'video').map(f => f.url);
    if (!fotoUrlsLightbox.length) return;
    lightboxIndex = Math.min(index, fotoUrlsLightbox.length - 1);
    const modal   = document.getElementById('lightboxModal');
    const img     = document.getElementById('lightboxImg');
    const caption = document.getElementById('lightboxCaption');
    if (!modal || !img) return;
    img.src = fotoUrlsLightbox[lightboxIndex];
    if (caption) caption.textContent = fotosArray[lightboxIndex]?.legenda || '';
    modal.style.display = 'flex';
}
function nextImage() {
    if (!fotoUrlsLightbox.length) return;
    lightboxIndex = (lightboxIndex + 1) % fotoUrlsLightbox.length;
    const img = document.getElementById('lightboxImg');
    if (img) img.src = fotoUrlsLightbox[lightboxIndex];
}
function prevImage() {
    if (!fotoUrlsLightbox.length) return;
    lightboxIndex = (lightboxIndex - 1 + fotoUrlsLightbox.length) % fotoUrlsLightbox.length;
    const img = document.getElementById('lightboxImg');
    if (img) img.src = fotoUrlsLightbox[lightboxIndex];
}

// ==================== CALENDÁRIO ====================
function inicializarCalendario(eventos) {
    const el = document.getElementById('calendar');
    if (!el) return;
    if (calendar) calendar.destroy();
    calendar = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        events: eventos.map(e => ({
            title: e.titulo, start: e.dataEvento,
            extendedProps: { descricao: e.descricao, fotos: e.fotos }
        })),
        eventClick: info => {
            abrirModalDetalhesEvento({ titulo: info.event.title, dataEvento: info.event.startStr, ...info.event.extendedProps });
            info.jsEvent.preventDefault();
        }
    });
    calendar.render();
}

// ==================== DATAS ESPECIAIS ====================
async function carregarDatasEspeciais() {
    try {
        const snap = await getDocs(query(collection(db, 'datasEspeciais'), orderBy('data')));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch { return []; }
}

async function verificarDataEspecialComFirestore() {
    const hojeStr = `${String(new Date().getDate()).padStart(2,'0')}/${String(new Date().getMonth()+1).padStart(2,'0')}`;
    const datas   = await carregarDatasEspeciais();
    const especial = datas.find(d => d.data === hojeStr);
    if (especial) { mostrarBannerDataEspecial(especial.descricao); iniciarChuvaCorações(8000); }
}

async function verificarLembretesDatas() {
    const hoje = new Date();
    const datas = await carregarDatasEspeciais();
    for (let i = 1; i <= 3; i++) {
        const futuro = new Date();
        futuro.setDate(hoje.getDate() + i);
        const s = `${String(futuro.getDate()).padStart(2,'0')}/${String(futuro.getMonth()+1).padStart(2,'0')}`;
        const especial = datas.find(d => d.data === s);
        if (especial) mostrarBannerDataEspecial(`📅 Em ${i} dia(s): ${especial.descricao}`);
    }
}

function solicitarPermissaoNotificacoes() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

// ==================== CONTADOR ====================
const elsContador = {};
function atualizarContador() {
    if (!elsContador.meses) {
        ['meses','semanas','dias','horas','minutos','segundos'].forEach(k => {
            elsContador[k] = document.getElementById(k);
        });
    }
    if (!elsContador.meses) { setTimeout(atualizarContador, 100); return; }
    let diff = Math.max(0, Date.now() - DATA_INICIO);
    elsContador.meses.textContent    = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.44));
    elsContador.semanas.textContent  = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
    elsContador.dias.textContent     = Math.floor(diff / (1000 * 60 * 60 * 24));
    elsContador.horas.textContent    = Math.floor(diff / (1000 * 60 * 60));
    elsContador.minutos.textContent  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    elsContador.segundos.textContent = Math.floor((diff % (1000 * 60)) / 1000);
}
document.addEventListener('DOMContentLoaded', () => {
    atualizarContador();
    setInterval(atualizarContador, 1000);
});

// ==================== SLIDESHOW ====================
let slideInterval = null, currentSlide = 0;
async function iniciarSlideshow() {
    if (!db) return;
    const snap = await getDocs(collection(db, 'fotos'));
    const urls = [];
    snap.forEach(d => { const u = d.data().url; if (u && !u.includes('placehold') && d.data().tipo !== 'video') urls.push(u); });
    if (!urls.length) return;

    const container = document.getElementById('slideshowContainer');
    if (!container) return;
    container.innerHTML = '';
    urls.forEach((url, i) => {
        const img = document.createElement('img');
        img.src   = url; img.className = 'slide-bg';
        if (i === 0) img.classList.add('active');
        container.appendChild(img);
    });
    currentSlide = 0;
    if (slideInterval) clearInterval(slideInterval);
    slideInterval = setInterval(() => {
        const slides = container.querySelectorAll('.slide-bg');
        if (!slides.length) return;
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');
    }, 8000);
}

// ==================== DIÁLOGO GENÉRICO (FIX #6) ====================
function mostrarDialogo(titulo, camposHtml, aoSalvar) {
    // Remove diálogo anterior se existir
    const existing = document.getElementById('genericDialog');
    if (existing) existing.remove();

    const dialog = document.createElement('dialog');
    dialog.id    = 'genericDialog';
    document.body.appendChild(dialog);

    dialog.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h2 style="margin:0;">${titulo}</h2>
            <button type="button" id="closeDialogBtn" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--cor-destaque);">&times;</button>
        </div>
        <form id="genericForm" method="dialog">
            ${camposHtml}
            <div class="dialog-buttons">
                <button type="submit" class="btn-admin">✅ Salvar</button>
                <button type="button" id="cancelDialogBtn" class="btn-admin">Cancelar</button>
            </div>
        </form>
    `;
    dialog.showModal();

    // Fechar ao clicar no backdrop (fora do diálogo)
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.querySelector('#closeDialogBtn').onclick  = () => dialog.close();
    dialog.querySelector('#cancelDialogBtn').onclick = () => dialog.close();

    const form      = dialog.querySelector('#genericForm');
    const submitBtn = form.querySelector('button[type="submit"]');

    // FIX: Impede form de fechar o modal via method="dialog" automaticamente
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const original = submitBtn.textContent;
        submitBtn.textContent = '⏳ Salvando...';
        submitBtn.disabled    = true;
        try {
            await aoSalvar(form);
            dialog.close();
        } catch (err) {
            alert('Erro: ' + err.message);
            submitBtn.textContent = original;
            submitBtn.disabled    = false;
        }
    });

    return dialog;
}

// ==================== ÁLBUM ====================
async function carregarFotos(categoria, reset = true) {
    if (!db || !albumGrid) return;
    if (reset) {
        albumGrid.innerHTML = '<p class="loading-text">⏳ Carregando fotos...</p>';
        ultimoDocFoto     = null;
        todasFotosCache   = [];
    }

    const constraints = [
        where('categoria', '==', categoria),
        orderBy('dataEnvio', 'desc'),
        limit(PAGE_SIZE + 1)
    ];
    if (ultimoDocFoto) constraints.push(startAfter(ultimoDocFoto));

    const q    = query(collection(db, 'fotos'), ...constraints);
    const snap = await getDocs(q);

    const hasMore = snap.docs.length > PAGE_SIZE;
    const docs    = hasMore ? snap.docs.slice(0, PAGE_SIZE) : snap.docs;

    if (snap.empty && reset) {
        albumGrid.innerHTML = '<p class="loading-text">Nenhuma mídia nesta categoria ainda.</p>';
        // FIX #4: Esconde botão quando não há mais fotos
        if (carregarMaisBtn) carregarMaisBtn.style.display = 'none';
        return;
    }

    todasFotosCache.push(...docs.map(d => ({ id: d.id, ...d.data() })));
    ultimoDocFoto = docs[docs.length - 1];
    // FIX #4: Controla visibilidade do botão corretamente
    if (carregarMaisBtn) carregarMaisBtn.style.display = hasMore ? 'inline-block' : 'none';

    aplicarOrdenacaoEFiltro();
}

function aplicarOrdenacaoEFiltro() {
    let fotos = [...todasFotosCache];
    const filtro    = document.getElementById('filtroData')?.value;
    const ordenacao = document.getElementById('ordenacaoAlbum')?.value;

    if (filtro) {
        const [ano, mes] = filtro.split('-').map(Number);
        fotos = fotos.filter(f => {
            const d = f.dataEnvio?.toDate?.();
            return d && d.getFullYear() === ano && d.getMonth() + 1 === mes;
        });
    }
    if (ordenacao === 'recente')      fotos.sort((a, b) => (b.dataEnvio?.toDate?.() || 0) - (a.dataEnvio?.toDate?.() || 0));
    else if (ordenacao === 'antigo')  fotos.sort((a, b) => (a.dataEnvio?.toDate?.() || 0) - (b.dataEnvio?.toDate?.() || 0));
    else if (ordenacao === 'az')      fotos.sort((a, b) => (a.legenda || '').localeCompare(b.legenda || ''));

    renderizarFotos(fotos);
}

function renderizarFotos(fotosArray) {
    albumGrid.innerHTML = '';
    fotosArray.forEach((foto, idx) => {
        if (!foto.url || foto.url.includes('placehold')) return;
        const card      = document.createElement('div');
        card.className  = 'card';
        card.innerHTML  = `
            <img src="${foto.url}" loading="lazy" alt="${escapeHtml(foto.legenda || '')}">
            <div class="card-content">
                <p>${escapeHtml(foto.legenda || '')}</p>
                ${foto.localizacao ? `<p><small>📍 ${escapeHtml(foto.localizacao)}</small></p>` : ''}
                <small>📅 ${foto.dataEnvio?.toDate?.().toLocaleDateString('pt-BR') || ''}</small>
                <small> · 👤 ${foto.enviadoPor === 'alexandre' ? 'Alexandre' : 'Ana'}</small>
                ${usuarioAtual === 'alexandre' ? `
                <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
                    <button class="editar-foto-btn btn-admin" data-id="${foto.id}">✏️</button>
                    <button class="remover-foto-btn btn-admin" data-id="${foto.id}">🗑️</button>
                </div>` : ''}
            </div>
        `;
        card.addEventListener('click', e => {
            if (e.target.classList.contains('editar-foto-btn') || e.target.classList.contains('remover-foto-btn')) return;
            abrirLightbox(fotosArray, idx);
        });
        albumGrid.appendChild(card);
    });

    if (usuarioAtual === 'alexandre') {
        albumGrid.querySelectorAll('.editar-foto-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const foto = todasFotosCache.find(f => f.id === btn.dataset.id);
                if (!foto) return;
                const legenda     = prompt('Nova legenda:', foto.legenda || '');
                if (legenda === null) return;
                const localizacao = prompt('Nova localização:', foto.localizacao || '');
                let coordenadas   = null;
                if (localizacao?.trim()) coordenadas = await obterCoordenadas(localizacao);
                await updateDoc(doc(db, 'fotos', btn.dataset.id), { legenda, localizacao: localizacao || null, coordenadas: coordenadas || null });
                carregarFotos(categoriaAtual, true);
            });
        });
        albumGrid.querySelectorAll('.remover-foto-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                if (!confirm('Remover permanentemente?')) return;
                await deleteDoc(doc(db, 'fotos', btn.dataset.id));
                carregarFotos(categoriaAtual, true);
                iniciarSlideshow();
            });
        });
    }
}

// ==================== SÉRIES / FILMES ====================
async function carregarSeries() {
    if (!db || !seriesList) return;
    seriesList.innerHTML = '<p class="loading-text">⏳ Carregando...</p>';
    const snap = await getDocs(query(collection(db, 'series'), orderBy('nome')));
    seriesList.innerHTML = '';
    if (snap.empty) { seriesList.innerHTML = '<p>Nenhuma série ou filme adicionado ainda.</p>'; return; }

    for (const docSnap of snap.docs) {
        const serie   = docSnap.data();
        const serieId = docSnap.id;
        const avSnap  = await getDocs(query(collection(db, 'avaliacoes'), where('serieId', '==', serieId)));
        let soma = 0, count = 0;
        avSnap.forEach(av => { soma += av.data().nota; count++; });
        const media = count ? (soma / count).toFixed(1) : '?';

        let capaURL = serie.capaURL;
        if (!capaURL || capaURL.includes('frame')) capaURL = 'https://placehold.co/400x200/8B0000/FFF?text=Sem+Imagem';

        const card     = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${capaURL}" alt="${escapeHtml(serie.nome)}" loading="lazy">
            <div class="card-content">
                <h3>${escapeHtml(serie.nome)}</h3>
                <p>${escapeHtml((serie.sinopse || '').substring(0, 80))}${serie.sinopse?.length > 80 ? '...' : ''}</p>
                <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;">
                    ${media !== '?' ? `<img src="${avaliacaoImgs[Math.round(media)]}" style="width:28px;height:28px;border-radius:50%;">` : ''}
                    <span>⭐ ${media}</span>
                    <span style="opacity:0.6;font-size:0.8rem;">${serie.tipo === 'serie' ? '📺' : '🎬'}</span>
                </div>
                ${usuarioAtual === 'alexandre' ? `<button class="remover-serie-btn btn-admin" data-id="${serieId}" style="margin-top:0.5rem;">🗑️ Remover</button>` : ''}
            </div>
        `;
        card.addEventListener('click', e => {
            if (e.target.classList.contains('remover-serie-btn')) return;
            abrirModalSerie(serieId, serie);
        });
        seriesList.appendChild(card);
    }

    if (usuarioAtual === 'alexandre') {
        seriesList.querySelectorAll('.remover-serie-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (!confirm('Apagar série e todos os episódios/avaliações?')) return;
                const epsSnap = await getDocs(query(collection(db, 'episodios'), where('serieId', '==', id)));
                for (const ep of epsSnap.docs) await deleteDoc(doc(db, 'episodios', ep.id));
                await deleteDoc(doc(db, 'series', id));
                carregarSeries();
            });
        });
    }
}

async function abrirModalSerie(serieId, serie) {
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;
    modalBody.innerHTML = '<p class="loading-text">⏳ Carregando...</p>';
    abrirModal('modal');

    const [epsSnap, avSnap] = await Promise.all([
        getDocs(query(collection(db, 'episodios'), where('serieId', '==', serieId), orderBy('numero', 'asc'))),
        getDocs(query(collection(db, 'avaliacoes'), where('serieId', '==', serieId), where('usuario', '==', usuarioAtual)))
    ]);

    const episodios    = epsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const minhaNotaDoc = avSnap.docs[0];
    const minhaAv      = minhaNotaDoc?.data()?.nota || 0;

    let capaURL = serie.capaURL;
    if (!capaURL || capaURL.includes('frame')) capaURL = 'https://placehold.co/120x180/8B0000/FFF?text=Capa';

    const epsHtml = episodios.length === 0
        ? '<p style="opacity:0.6;">Nenhum episódio adicionado ainda.</p>'
        : episodios.map(ep => `
            <div class="episodio-item" id="ep-${ep.id}">
                ${ep.fotoURL ? `<img src="${escapeHtml(ep.fotoURL)}" loading="lazy">` : ''}
                <strong>Ep. ${ep.numero || '?'} — ${escapeHtml(ep.titulo || '')}</strong>
                <p style="font-size:0.85rem;opacity:0.8;margin:0.3rem 0;">${escapeHtml(ep.descricao || '')}</p>
                <div id="comentarios-ep-${ep.id}" style="background:rgba(0,0,0,0.04);border-radius:12px;padding:0.6rem;margin-top:0.4rem;font-size:0.85rem;"></div>
                <div style="display:flex;gap:0.4rem;margin-top:0.4rem;flex-wrap:wrap;">
                    <textarea id="comentarioEp-${ep.id}" rows="2" placeholder="Comentar episódio..." style="flex:1;min-width:100px;border-radius:16px;padding:0.5rem;font-size:0.85rem;"></textarea>
                    <button class="salvar-comentario-ep btn-admin" data-ep-id="${ep.id}" title="Enviar">💬</button>
                    ${usuarioAtual === 'alexandre' ? `<button class="remover-ep-btn btn-admin" data-ep-id="${ep.id}" title="Remover episódio">🗑️</button>` : ''}
                </div>
            </div>
        `).join('');

    modalBody.innerHTML = `
        <div style="display:flex;gap:1.2rem;flex-wrap:wrap;margin-bottom:1.5rem;">
            <img src="${capaURL}" style="width:110px;border-radius:14px;object-fit:cover;align-self:flex-start;" loading="lazy">
            <div style="flex:1;min-width:180px;">
                <h2 style="color:var(--cor-destaque);margin-bottom:0.3rem;">${escapeHtml(serie.nome)}</h2>
                <span style="background:var(--cor-borda);padding:0.2rem 0.8rem;border-radius:20px;font-size:0.8rem;">${serie.tipo === 'serie' ? '📺 Série' : '🎬 Filme'}</span>
                <p style="margin-top:0.7rem;opacity:0.85;font-size:0.9rem;">${escapeHtml(serie.sinopse || '')}</p>
            </div>
        </div>
        <div style="margin-bottom:1.5rem;">
            <h3 style="margin-bottom:0.8rem;">⭐ Sua avaliação</h3>
            <div class="avaliacao-container">
                ${[1,2,3,4,5].map(n => `
                    <button class="avaliacao-btn ${minhaAv === n ? 'selected' : ''}" data-nota="${n}">
                        <img src="${avaliacaoImgs[n]}" alt="${n}">
                    </button>`).join('')}
            </div>
        </div>
        <div style="margin-bottom:1.5rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                <h3>📺 Episódios / Temporadas</h3>
                ${usuarioAtual === 'alexandre' ? `<button id="addEpBtn" class="btn-admin">+ Episódio</button>` : ''}
            </div>
            <div id="listaEpisodiosModal">${epsHtml}</div>
        </div>
        <div>
            <h3 style="margin-bottom:0.8rem;">💬 Comentários gerais</h3>
            <div id="comentariosFilme" style="background:rgba(0,0,0,0.04);border-radius:16px;padding:0.8rem;margin-bottom:0.8rem;max-height:180px;overflow-y:auto;font-size:0.85rem;"></div>
            <div style="display:flex;gap:0.5rem;">
                <textarea id="comentarioFilmeInput" rows="2" placeholder="Seu comentário sobre ${escapeHtml(serie.nome)}..." style="flex:1;border-radius:16px;padding:0.6rem;"></textarea>
                <button id="salvarComentarioFilme" class="btn-admin">💬</button>
            </div>
        </div>
    `;

    // Avaliação
    modalBody.querySelectorAll('.avaliacao-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const nota = parseInt(btn.dataset.nota);
            if (minhaNotaDoc) await updateDoc(doc(db, 'avaliacoes', minhaNotaDoc.id), { nota });
            else await addDoc(collection(db, 'avaliacoes'), { serieId, nota, usuario: usuarioAtual, data: new Date() });
            modalBody.querySelectorAll('.avaliacao-btn').forEach(b =>
                b.classList.toggle('selected', parseInt(b.dataset.nota) === nota)
            );
            carregarSeries();
        });
    });

    // Comentários por episódio
    for (const ep of episodios) {
        const comSnap = await getDocs(query(collection(db, 'comentarios'), where('episodioId', '==', ep.id), orderBy('data', 'asc')));
        const div     = document.getElementById(`comentarios-ep-${ep.id}`);
        if (div) renderComentarios(div, comSnap.docs);
    }

    // Comentários gerais
    const gComSnap = await getDocs(query(collection(db, 'comentarios'), where('serieId', '==', serieId), where('episodioId', '==', ''), orderBy('data', 'asc')));
    const gDiv     = document.getElementById('comentariosFilme');
    if (gDiv) renderComentarios(gDiv, gComSnap.docs);

    document.getElementById('salvarComentarioFilme')?.addEventListener('click', async () => {
        const input = document.getElementById('comentarioFilmeInput');
        const texto = input?.value.trim();
        if (!texto) return;
        await addDoc(collection(db, 'comentarios'), { serieId, episodioId: '', texto, autor: usuarioAtual, data: new Date() });
        input.value = '';
        abrirModalSerie(serieId, serie);
    });

    modalBody.querySelectorAll('.salvar-comentario-ep').forEach(btn => {
        btn.addEventListener('click', async () => {
            const epId  = btn.dataset.epId;
            const input = document.getElementById(`comentarioEp-${epId}`);
            const texto = input?.value.trim();
            if (!texto) return;
            await addDoc(collection(db, 'comentarios'), { serieId, episodioId: epId, texto, autor: usuarioAtual, data: new Date() });
            input.value = '';
            abrirModalSerie(serieId, serie);
        });
    });

    if (usuarioAtual === 'alexandre') {
        modalBody.querySelectorAll('.remover-ep-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remover episódio?')) return;
                await deleteDoc(doc(db, 'episodios', btn.dataset.epId));
                abrirModalSerie(serieId, serie);
            });
        });

        document.getElementById('addEpBtn')?.addEventListener('click', () => {
            mostrarDialogo('📺 Novo Episódio', `
                <label>Número</label><input type="number" id="epNum" min="1" value="${episodios.length + 1}">
                <label>Título *</label><input type="text" id="epTitulo" required>
                <label>Descrição</label><textarea id="epDescricao" rows="2"></textarea>
                <label>Foto (opcional)</label><input type="file" id="epFoto" accept="image/*">
            `, async form => {
                const numero    = parseInt(form.querySelector('#epNum').value) || episodios.length + 1;
                const titulo    = form.querySelector('#epTitulo').value.trim();
                const descricao = form.querySelector('#epDescricao').value.trim();
                const file      = form.querySelector('#epFoto').files[0];
                let fotoURL     = '';
                if (file) fotoURL = await uploadParaImgBB(file);
                await addDoc(collection(db, 'episodios'), { serieId, numero, titulo, descricao, fotoURL, criadoPor: usuarioAtual, criadoEm: new Date() });
                abrirModalSerie(serieId, serie);
            });
        });
    }
}

function renderComentarios(container, docs) {
    if (!docs.length) {
        container.innerHTML = '<em style="opacity:0.5;">Sem comentários ainda.</em>';
        return;
    }
    container.innerHTML = docs.map(d => {
        const c = d.data();
        return `<div style="background:var(--cor-card-fundo);border-radius:10px;padding:0.4rem 0.7rem;margin-bottom:0.4rem;">
            <strong style="font-size:0.8rem;color:var(--cor-destaque);">${c.autor === 'alexandre' ? 'Alexandre' : 'Ana'}</strong>
            <span style="margin-left:0.4rem;">${escapeHtml(c.texto)}</span>
        </div>`;
    }).join('');
}

// FIX #2 e #3: adicionarSerieDialog existe e funcionará quando o btn tiver o listener
function adicionarSerieDialog() {
    if (usuarioAtual !== 'alexandre') { alert('Apenas Alexandre pode adicionar.'); return; }
    mostrarDialogo('🎬 Nova Série/Filme', `
        <label>Nome *</label><input type="text" id="nomeSerieD" required>
        <label>Tipo</label>
        <select id="tipoSerieD" style="border-radius:40px;">
            <option value="serie">📺 Série</option>
            <option value="filme">🎬 Filme</option>
        </select>
        <label>Sinopse</label><textarea id="sinopseSerieD" rows="3"></textarea>
        <label>Upload da capa</label><input type="file" id="capaSerieFile" accept="image/*">
        <label>ou URL da capa</label><input type="text" id="capaSerieUrl" placeholder="https://...">
    `, async form => {
        const nome     = form.querySelector('#nomeSerieD').value.trim();
        const tipo     = form.querySelector('#tipoSerieD').value;
        const sinopse  = form.querySelector('#sinopseSerieD').value.trim();
        const file     = form.querySelector('#capaSerieFile').files[0];
        let capaURL    = form.querySelector('#capaSerieUrl').value.trim();
        if (file) capaURL = await uploadParaImgBB(file);
        await addDoc(collection(db, 'series'), { nome, tipo, sinopse, capaURL, criadoPor: usuarioAtual, criadoEm: new Date() });
        carregarSeries();
        await criarNotificacao('serie', '', nome, 'adicionou');
    });
}

// ==================== VIAGENS (FIX: loading infinito corrigido) ====================
async function carregarViagens() {
    if (!db || !viagensList) return;
    viagensList.innerHTML = '<p class="loading-text">⏳ Carregando...</p>';
    try {
        // FIX: Busca todas as viagens (não só planejadas), usando try/catch robusto
        const snap = await getDocs(query(collection(db, 'viagens'), orderBy('criadoEm', 'desc')));
        viagensList.innerHTML = '';
        if (snap.empty) { viagensList.innerHTML = '<p>Nenhuma viagem cadastrada ainda.</p>'; return; }

        for (const docSnap of snap.docs) {
            const viagem   = docSnap.data();
            const viagemId = docSnap.id;

            // Conta locais sem await encadeado problemático
            let visitados = 0, totalLocais = 0;
            try {
                const locaisSnap = await getDocs(query(collection(db, 'locais'), where('viagemId', '==', viagemId)));
                totalLocais = locaisSnap.size;
                visitados   = locaisSnap.docs.filter(d => d.data().visitado).length;
            } catch (e) {
                console.warn('Erro ao carregar locais da viagem:', viagemId, e);
            }

            const statusLabel = viagem.status === 'realizada' ? '✅ Realizada' : '📝 Planejada';
            const statusColor = viagem.status === 'realizada' ? '#2ecc71' : '#e67e22';

            const card     = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-content">
                    <h3>✈️ ${escapeHtml(viagem.nome)}</h3>
                    <p>📅 ${viagem.dataPrevista ? new Date(viagem.dataPrevista + 'T00:00:00').toLocaleDateString('pt-BR') : 'A definir'}</p>
                    <p style="font-size:0.85rem;opacity:0.7;">📍 ${visitados}/${totalLocais} locais visitados</p>
                    <span style="background:${statusColor};color:white;padding:0.2rem 0.8rem;border-radius:20px;font-size:0.75rem;font-weight:bold;">${statusLabel}</span>
                    ${usuarioAtual === 'alexandre' ? `
                    <div style="margin-top:0.8rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
                        ${viagem.status !== 'realizada' ? `<button class="arquivarViagemBtn btn-admin" data-id="${viagemId}">✅ Marcar realizada</button>` : ''}
                        <button class="apagarViagemBtn btn-admin" data-id="${viagemId}">🗑️ Apagar</button>
                    </div>` : ''}
                </div>
            `;
            card.addEventListener('click', e => {
                if (e.target.classList.contains('apagarViagemBtn') || e.target.classList.contains('arquivarViagemBtn')) return;
                abrirModalViagem(viagemId);
            });
            viagensList.appendChild(card);
        }

        if (usuarioAtual === 'alexandre') {
            viagensList.querySelectorAll('.arquivarViagemBtn').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    await updateDoc(doc(db, 'viagens', btn.dataset.id), { status: 'realizada' });
                    carregarViagens();
                });
            });

            viagensList.querySelectorAll('.apagarViagemBtn').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    if (!confirm('Apagar viagem e todos os locais/fotos?')) return;
                    const id         = btn.dataset.id;
                    const locaisSnap = await getDocs(query(collection(db, 'locais'), where('viagemId', '==', id)));
                    for (const l of locaisSnap.docs) {
                        const fSnap = await getDocs(query(collection(db, 'fotosViagens'), where('localId', '==', l.id)));
                        for (const f of fSnap.docs) await deleteDoc(doc(db, 'fotosViagens', f.id));
                        await deleteDoc(doc(db, 'locais', l.id));
                    }
                    await deleteDoc(doc(db, 'viagens', id));
                    carregarViagens();
                });
            });
        }
    } catch (err) {
        console.error("Erro ao carregar viagens:", err);
        viagensList.innerHTML = '<p>❌ Erro ao carregar viagens. Verifique o console.</p>';
    }
}

async function abrirModalViagem(viagemId) {
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;
    modalBody.innerHTML = '<p class="loading-text">⏳ Carregando...</p>';
    abrirModal('modal');

    try {
        const [viagemDoc, locaisSnap] = await Promise.all([
            getDoc(doc(db, 'viagens', viagemId)),
            getDocs(query(collection(db, 'locais'), where('viagemId', '==', viagemId), orderBy('criadoEm', 'asc')))
        ]);

        if (!viagemDoc.exists()) {
            modalBody.innerHTML = '<p>Viagem não encontrada.</p>';
            return;
        }

        const viagem = viagemDoc.data();
        const locais = locaisSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const locaisHtml = locais.length === 0
            ? '<p style="opacity:0.6;">Nenhum local adicionado ainda.</p>'
            : locais.map(local => `
                <div class="local-card" id="local-card-${local.id}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">
                        <div style="flex:1;">
                            <h4>${local.visitado ? '✅' : '📍'} ${escapeHtml(local.nome)}</h4>
                            <p style="font-size:0.85rem;opacity:0.8;">${escapeHtml(local.descricao || '')}</p>
                            ${local.coordenadas ? `<small style="opacity:0.5;">📌 ${Number(local.coordenadas.lat).toFixed(4)}, ${Number(local.coordenadas.lng).toFixed(4)}</small>` : ''}
                        </div>
                        ${usuarioAtual === 'alexandre' ? `
                        <div class="local-card-actions">
                            <button class="toggleVisitadoBtn btn-admin" data-id="${local.id}" data-visitado="${local.visitado}">
                                ${local.visitado ? '↩️ Pendente' : '✅ Visitado'}
                            </button>
                            <button class="addFotoLocalBtn btn-admin" data-id="${local.id}">📷</button>
                            <button class="removerLocalBtn btn-admin" data-id="${local.id}">🗑️</button>
                        </div>` : ''}
                    </div>
                    <div id="fotosLocal-${local.id}" class="local-fotos"></div>
                </div>
            `).join('');

        modalBody.innerHTML = `
            <h2>✈️ ${escapeHtml(viagem.nome)}</h2>
            <p style="opacity:0.7;margin-bottom:1.5rem;">📅 ${viagem.dataPrevista ? new Date(viagem.dataPrevista + 'T00:00:00').toLocaleDateString('pt-BR') : 'Data a definir'}</p>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                <h3>📍 Locais (${locais.length})</h3>
                ${usuarioAtual === 'alexandre' ? `<button id="addLocalModalBtn" class="btn-admin">+ Adicionar local</button>` : ''}
            </div>
            <div id="listaLocaisModal">${locaisHtml}</div>
        `;

        // Carregar fotos de cada local
        for (const local of locais) {
            const fSnap = await getDocs(query(collection(db, 'fotosViagens'), where('localId', '==', local.id)));
            const div   = document.getElementById(`fotosLocal-${local.id}`);
            if (div && !fSnap.empty) {
                div.innerHTML = fSnap.docs.map(f =>
                    `<img src="${f.data().url}" loading="lazy" onclick="window.open('${f.data().url}','_blank')" title="Ver foto">`
                ).join('');
            }
        }

        document.getElementById('addLocalModalBtn')?.addEventListener('click', () => adicionarLocalDialog(viagemId));

        if (usuarioAtual === 'alexandre') {
            modalBody.querySelectorAll('.toggleVisitadoBtn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const visitado = btn.dataset.visitado === 'true';
                    await updateDoc(doc(db, 'locais', btn.dataset.id), { visitado: !visitado });
                    abrirModalViagem(viagemId);
                });
            });

            modalBody.querySelectorAll('.addFotoLocalBtn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const localId = btn.dataset.id;
                    const fi      = document.createElement('input');
                    fi.type       = 'file'; fi.accept = 'image/*';
                    fi.onchange   = async e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const url  = await uploadParaImgBB(file);
                        await addDoc(collection(db, 'fotosViagens'), { localId, viagemId, url, enviadoPor: usuarioAtual, data: new Date() });
                        abrirModalViagem(viagemId);
                    };
                    fi.click();
                });
            });

            modalBody.querySelectorAll('.removerLocalBtn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Remover este local?')) return;
                    const id    = btn.dataset.id;
                    const fSnap = await getDocs(query(collection(db, 'fotosViagens'), where('localId', '==', id)));
                    for (const f of fSnap.docs) await deleteDoc(doc(db, 'fotosViagens', f.id));
                    await deleteDoc(doc(db, 'locais', id));
                    abrirModalViagem(viagemId);
                });
            });
        }
    } catch (err) {
        console.error("Erro ao abrir viagem:", err);
        modalBody.innerHTML = '<p>❌ Erro ao carregar dados da viagem.</p>';
    }
}

function adicionarLocalDialog(viagemId) {
    mostrarDialogo('📍 Novo Local', `
        <label>Nome do local *</label><input type="text" id="localNome" required>
        <label>Endereço (para o mapa)</label><input type="text" id="localEndereco">
        <label>Descrição</label><textarea id="localDescricao" rows="2"></textarea>
    `, async form => {
        const nome      = form.querySelector('#localNome').value.trim();
        const endereco  = form.querySelector('#localEndereco').value.trim();
        const descricao = form.querySelector('#localDescricao').value.trim();
        const coordenadas = endereco ? await obterCoordenadas(endereco) : null;
        await addDoc(collection(db, 'locais'), {
            viagemId, nome, descricao, visitado: false,
            criadoPor: usuarioAtual, criadoEm: new Date(),
            coordenadas: coordenadas || null
        });
        abrirModalViagem(viagemId);
    });
}

function adicionarViagemDialog() {
    mostrarDialogo('✈️ Nova Viagem', `
        <label>Nome da viagem *</label><input type="text" id="nomeViagem" required>
        <label>Data prevista</label><input type="date" id="dataViagem">
    `, async form => {
        const nome = form.querySelector('#nomeViagem').value.trim();
        const data = form.querySelector('#dataViagem').value;
        await addDoc(collection(db, 'viagens'), {
            nome, dataPrevista: data,
            criadoPor: usuarioAtual, criadoEm: new Date(),
            status: 'planejada'
        });
        carregarViagens();
    });
}

// ==================== METAS ====================
async function carregarMetas() {
    if (!db || !metasList) return;
    metasList.innerHTML = '<p class="loading-text">⏳ Carregando...</p>';
    try {
        const snap = await getDocs(query(collection(db, 'metas'), orderBy('criadoEm', 'desc')));
        metasList.innerHTML = '';
        if (snap.empty) { metasList.innerHTML = '<p>Nenhuma meta cadastrada ainda.</p>'; return; }

        for (const docSnap of snap.docs) {
            const meta   = docSnap.data();
            const metaId = docSnap.id;
            const card   = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-content">
                    <div class="meta-status ${meta.concluida ? 'concluida' : 'pendente'}">${meta.concluida ? '✅ Concluída' : '⏳ Pendente'}</div>
                    <h3>${escapeHtml(meta.titulo)}</h3>
                    <p>${escapeHtml(meta.descricao || '')}</p>
                    ${meta.fotoURL ? `<img src="${meta.fotoURL}" style="width:100%;height:150px;object-fit:cover;border-radius:16px;margin-top:0.5rem;">` : ''}
                    ${usuarioAtual === 'alexandre' ? `
                    <div class="meta-botoes">
                        <button class="concluirMetaBtn btn-admin" data-id="${metaId}" data-concluida="${meta.concluida}">${meta.concluida ? '↩️ Reabrir' : '✅ Concluir'}</button>
                        <button class="editarMetaBtn btn-admin" data-id="${metaId}">✏️</button>
                        <button class="apagarMetaBtn btn-admin" data-id="${metaId}">🗑️</button>
                    </div>` : ''}
                </div>
            `;
            metasList.appendChild(card);
        }

        if (usuarioAtual === 'alexandre') {
            metasList.querySelectorAll('.concluirMetaBtn').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    const atualmente = btn.dataset.concluida === 'true';
                    await updateDoc(doc(db, 'metas', btn.dataset.id), { concluida: !atualmente });
                    carregarMetas();
                });
            });
            metasList.querySelectorAll('.editarMetaBtn').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    const ref  = doc(db, 'metas', btn.dataset.id);
                    const snap = await getDoc(ref);
                    if (!snap.exists()) return;
                    const meta = snap.data();
                    mostrarDialogo('✏️ Editar Meta', `
                        <label>Título *</label><input type="text" id="editTituloMeta" value="${escapeHtml(meta.titulo)}" required>
                        <label>Descrição</label><textarea id="editDescMeta" rows="2">${escapeHtml(meta.descricao || '')}</textarea>
                        <label>Nova foto (opcional)</label><input type="file" id="editFotoMeta" accept="image/*">
                    `, async form => {
                        const titulo    = form.querySelector('#editTituloMeta').value.trim();
                        const descricao = form.querySelector('#editDescMeta').value.trim();
                        const file      = form.querySelector('#editFotoMeta').files[0];
                        let fotoURL     = meta.fotoURL;
                        if (file) fotoURL = await uploadParaImgBB(file);
                        await updateDoc(ref, { titulo, descricao, fotoURL });
                        carregarMetas();
                    });
                });
            });
            metasList.querySelectorAll('.apagarMetaBtn').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    if (!confirm('Apagar meta permanentemente?')) return;
                    await deleteDoc(doc(db, 'metas', btn.dataset.id));
                    carregarMetas();
                });
            });
        }
    } catch (err) { console.error("Erro ao carregar metas:", err); }
}

function adicionarMetaDialog() {
    if (usuarioAtual !== 'alexandre') { alert('Apenas Alexandre pode adicionar.'); return; }
    mostrarDialogo('🎯 Nova Meta', `
        <label>Título *</label><input type="text" id="tituloMeta" required>
        <label>Descrição</label><textarea id="descricaoMeta" rows="2"></textarea>
        <label>Foto ilustrativa (opcional)</label><input type="file" id="fotoMeta" accept="image/*">
    `, async form => {
        const titulo    = form.querySelector('#tituloMeta').value.trim();
        const descricao = form.querySelector('#descricaoMeta').value.trim();
        const file      = form.querySelector('#fotoMeta').files[0];
        let fotoURL     = '';
        if (file) fotoURL = await uploadParaImgBB(file);
        await addDoc(collection(db, 'metas'), { titulo, descricao, fotoURL, concluida: false, criadoPor: usuarioAtual, criadoEm: new Date() });
        carregarMetas();
        await criarNotificacao('meta', '', titulo, 'adicionou');
    });
}

// ==================== TIMELINE (redesenhada com fotos múltiplas) ====================
function mostrarFormularioTimeline() {
    if (usuarioAtual !== 'alexandre') { alert('Apenas Alexandre pode adicionar.'); return; }
    mostrarDialogo('➕ Novo Evento na Linha do Tempo', `
        <label>Título *</label>
        <input type="text" id="eventoTitulo" required placeholder="Ex: Nosso primeiro beijo 💋">
        <label>Data *</label>
        <input type="date" id="eventoData" required>
        <label>Descrição</label>
        <textarea id="eventoDescricao" rows="3" placeholder="Conta um pouco sobre esse momento especial..."></textarea>
        <label>Fotos do evento (opcional, múltiplas)</label>
        <input type="file" id="eventoFotos" accept="image/*" multiple>
        <div id="previewFotosEvento" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;"></div>
    `, async form => {
        const titulo     = form.querySelector('#eventoTitulo').value.trim();
        const dataEvento = form.querySelector('#eventoData').value;
        const descricao  = form.querySelector('#eventoDescricao').value.trim();
        const files      = Array.from(form.querySelector('#eventoFotos').files);

        const fotos = [];
        for (const file of files) {
            const url = await uploadParaImgBB(file);
            fotos.push(url);
        }

        await addDoc(collection(db, 'timeline'), {
            titulo, dataEvento, descricao, fotos,
            criadoPor: usuarioAtual, criadoEm: new Date()
        });
        carregarTimeline();
    });

    // Preview das fotos selecionadas
    setTimeout(() => {
        const input = document.querySelector('#genericDialog #eventoFotos');
        if (input) {
            input.addEventListener('change', e => {
                const preview = document.getElementById('previewFotosEvento');
                if (!preview) return;
                preview.innerHTML = '';
                Array.from(e.target.files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const img = document.createElement('img');
                        img.src   = ev.target.result;
                        img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:8px;';
                        preview.appendChild(img);
                    };
                    reader.readAsDataURL(file);
                });
            });
        }
    }, 100);
}

async function carregarTimeline() {
    if (!db || !timelineList) return;
    try {
        const snap = await getDocs(query(collection(db, 'timeline'), orderBy('dataEvento', 'asc')));
        timelineList.innerHTML = '';

        if (snap.empty) {
            timelineList.innerHTML = '<p style="text-align:center;opacity:0.6;padding:2rem;">Nenhum evento na linha do tempo ainda. Clique em "+ Adicionar evento" para começar! 💕</p>';
            return;
        }

        const eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // ── Navegador horizontal (miniaturas de datas) ──────────────────────────
        const navDiv = document.createElement('div');
        navDiv.className = 'timeline-horizontal';
        navDiv.id        = 'timelineNav';

        eventos.forEach((evento, i) => {
            if (i > 0) {
                const line = document.createElement('div');
                line.className = 'timeline-line-h';
                navDiv.appendChild(line);
            }
            const marker = document.createElement('div');
            marker.className = 'timeline-marker-h';
            marker.title     = `${evento.titulo} — ${formatarDataBR(evento.dataEvento)}`;
            marker.addEventListener('click', () => {
                document.getElementById(`evento-${evento.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                document.querySelectorAll('.timeline-marker-h').forEach(m => m.classList.remove('active'));
                marker.classList.add('active');
            });
            navDiv.appendChild(marker);
        });
        timelineList.appendChild(navDiv);

        // ── Cards verticais ─────────────────────────────────────────────────────
        eventos.forEach(evento => {
            const card     = document.createElement('div');
            card.className = 'timeline-card';
            card.id        = `evento-${evento.id}`;

            // Primeira foto como thumbnail (se houver)
            const thumbHtml = (evento.fotos && evento.fotos.length > 0)
                ? `<div class="timeline-fotos">
                       <img src="${evento.fotos[0]}" loading="lazy" alt="${escapeHtml(evento.titulo)}"
                            onclick="event.stopPropagation();abrirLightboxTimeline(${JSON.stringify(evento.fotos).replace(/"/g, '&quot;')})">
                   </div>`
                : '';

            const extraFotos = (evento.fotos && evento.fotos.length > 1)
                ? `<span style="font-size:0.75rem;opacity:0.6;">+${evento.fotos.length - 1} foto(s)</span>`
                : '';

            card.innerHTML = `
                <div class="timeline-marker"></div>
                <div class="timeline-card-content">
                    <div class="timeline-content-wrapper">
                        ${thumbHtml}
                        <div class="timeline-text">
                            <div class="timeline-data">📅 ${formatarDataBR(evento.dataEvento)}</div>
                            <h3>${escapeHtml(evento.titulo)}</h3>
                            <p>${escapeHtml(evento.descricao || '')}</p>
                            ${extraFotos}
                        </div>
                    </div>
                </div>
                ${usuarioAtual === 'alexandre' ? `<button class="remover-timeline-btn btn-admin remover-timeline-btn" data-id="${evento.id}">🗑️</button>` : ''}
            `;

            card.addEventListener('click', e => {
                if (e.target.classList.contains('remover-timeline-btn')) return;
                abrirModalDetalhesEvento(evento);
            });

            timelineList.appendChild(card);
        });

        // Listeners de remoção
        if (usuarioAtual === 'alexandre') {
            timelineList.querySelectorAll('.remover-timeline-btn').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    if (!confirm('Remover este evento da linha do tempo?')) return;
                    await deleteDoc(doc(db, 'timeline', btn.dataset.id));
                    carregarTimeline();
                });
            });
        }

        // Sincronizar com calendário
        if (document.getElementById('calendar')) inicializarCalendario(eventos);

    } catch (err) {
        console.error("Timeline error:", err);
        timelineList.innerHTML = '<p>❌ Erro ao carregar linha do tempo.</p>';
    }
}

// Abre lightbox para fotos do evento da timeline
function abrirLightboxTimeline(fotosArray) {
    fotoUrlsLightbox = fotosArray;
    lightboxIndex    = 0;
    const modal   = document.getElementById('lightboxModal');
    const img     = document.getElementById('lightboxImg');
    if (!modal || !img) return;
    img.src             = fotoUrlsLightbox[0];
    modal.style.display = 'flex';
}
window.abrirLightboxTimeline = abrirLightboxTimeline;

function abrirModalDetalhesEvento(evento) {
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;

    const fotosHtml = (evento.fotos && evento.fotos.length > 0)
        ? `<div class="modal-detail-fotos">
               ${evento.fotos.map(f => `<img src="${f}" loading="lazy" onclick="window.open('${f}','_blank')">`).join('')}
           </div>`
        : '';

    modalBody.innerHTML = `
        <h2>${escapeHtml(evento.titulo)}</h2>
        <p style="color:var(--cor-destaque);font-weight:600;margin:0.5rem 0;">📅 ${formatarDataBR(evento.dataEvento)}</p>
        <p style="margin-bottom:1rem;">${escapeHtml(evento.descricao || '')}</p>
        ${fotosHtml}
    `;
    abrirModal('modal');
}

// ==================== MAPA ====================
async function limparMarcadores() {
    if (mapa && currentMarkers.length) { currentMarkers.forEach(m => mapa.removeLayer(m)); currentMarkers = []; }
    if (rotaControl) { mapa.removeControl(rotaControl); rotaControl = null; }
}

async function inicializarMapa() {
    if (mapaInicializado) return;
    if (typeof L === 'undefined') { setTimeout(inicializarMapa, 500); return; }
    const container = document.getElementById('mapaContainer');
    if (!container) return;
    mapa = L.map(container).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OSM &amp; CartoDB'
    }).addTo(mapa);
    mapaInicializado = true;
}

async function carregarLocaisNoMapa() {
    if (!mapa) return;
    await limparMarcadores();
    const snap = await getDocs(collection(db, 'locais'));
    snap.forEach(d => {
        const local = d.data();
        if (!local.coordenadas?.lat) return;
        const cor    = local.visitado ? '#2ecc71' : '#e74c3c';
        const marker = L.marker([local.coordenadas.lat, local.coordenadas.lng], {
            icon: L.divIcon({
                html: `<div style="background:${cor};width:24px;height:24px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:14px;">📍</div>`,
                iconSize: [24, 24], popupAnchor: [0, -12]
            })
        }).addTo(mapa);
        marker.bindPopup(`<strong>${escapeHtml(local.nome)}</strong><br>${local.visitado ? '✅ Visitado' : '⏳ Pendente'}`);
        currentMarkers.push(marker);
    });
}

async function tracarRotaEntreLocais() {
    if (!mapa) { await inicializarMapa(); setTimeout(tracarRotaEntreLocais, 500); return; }
    if (rotaControl) { mapa.removeControl(rotaControl); rotaControl = null; }
    const snap   = await getDocs(collection(db, 'locais'));
    const pontos = snap.docs
        .map(d => d.data())
        .filter(l => l.visitado && l.coordenadas?.lat)
        .map(l => L.latLng(l.coordenadas.lat, l.coordenadas.lng));
    if (pontos.length < 2) { alert("Precisa de ao menos dois locais visitados para traçar rota."); return; }
    rotaControl = L.Routing.control({
        waypoints: pontos,
        routeWhileDragging: false,
        lineOptions: { styles: [{ color: '#b83b5e', weight: 4 }] }
    }).addTo(mapa);
}

// ==================== PLAYER DE MÚSICA LOCAL ====================
function initMusicPlayerLocal() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    if (!playPauseBtn) return;

    audioPlayer        = new Audio('musica-fundo.mp3');
    audioPlayer.loop   = true;
    audioPlayer.volume = 0.35;

    document.getElementById('playerTitle').textContent   = "Nossa Música Especial";
    document.getElementById('playerChannel').textContent = "Trilha do Nosso Amor";
    document.getElementById('playerThumb').src = "https://media.discordapp.net/attachments/935732645797703681/1465868343838773382/rs.jpg?ex=6a2bfd87&is=6a2aac07&hm=28f71500d17d67cddcbea87e2f2682d58112255e31e8ee01c5cbde8add0242d3&=&format=webp&width=1000&height=800";

    playPauseBtn.onclick = () => {
        if (musicPlaying) { audioPlayer.pause(); playPauseBtn.textContent = '▶️'; }
        else              { audioPlayer.play().catch(() => {}); playPauseBtn.textContent = '⏸️'; }
        musicPlaying = !musicPlaying;
    };

    const volSlider = document.getElementById('volumeSlider');
    const volIcon   = document.getElementById('volumeIcon');
    if (volSlider) {
        volSlider.addEventListener('input', e => {
            audioPlayer.volume = parseFloat(e.target.value);
            if (volIcon) volIcon.textContent = audioPlayer.volume === 0 ? '🔇' : audioPlayer.volume < 0.5 ? '🔉' : '🔊';
        });
    }

    setInterval(() => {
        if (!isNaN(audioPlayer.duration)) {
            const cur = audioPlayer.currentTime, dur = audioPlayer.duration;
            const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
            const el  = document.getElementById('timeInfo');
            if (el) el.textContent = `${fmt(cur)} / ${fmt(dur)}`;
        }
    }, 500);
}

// ==================== NAVEGAÇÃO ====================
function inicializarNavegacao() {
    const conteudos = {
        album:        document.getElementById('conteudoAlbum'),
        series:       document.getElementById('conteudoSeries'),
        viagens:      document.getElementById('conteudoViagens'),
        metas:        document.getElementById('conteudoMetas'),
        timeline:     document.getElementById('conteudoTimeline'),
        calendario:   document.getElementById('conteudoCalendario'),
        estatisticas: document.getElementById('conteudoEstatisticas'),
        chat:         document.getElementById('conteudoChat'),
        musica:       document.getElementById('conteudoMusica'),
        spotify:      document.getElementById('conteudoSpotify')
    };

    function ativarAba(abaId) {
        Object.values(conteudos).forEach(c => { if (c) c.style.display = 'none'; });
        if (conteudos[abaId]) conteudos[abaId].style.display = 'block';
        document.querySelectorAll('.aba-btn').forEach(btn => btn.classList.toggle('ativo', btn.dataset.aba === abaId));
        if (abaId === 'calendario' && calendar) calendar.render();
        if (abaId === 'estatisticas') carregarEstatisticas();
    }

    document.querySelectorAll('.aba-btn').forEach(btn => btn.addEventListener('click', () => ativarAba(btn.dataset.aba)));
    ativarAba('album');
}

// ==================== PERFIS ====================
function selecionarPerfil(perfil) {
    usuarioAtual = perfil;
    localStorage.setItem('usuarioAtual', perfil);
    document.getElementById('perfilSeletor').style.display  = 'none';
    document.getElementById('usuarioAtual').style.display   = 'inline-block';
    document.getElementById('nomeUsuario').textContent       = perfil === 'alexandre' ? 'Alexandre 🖤' : 'Ana Vitória 💖';

    carregarSeries();
    carregarViagens();
    carregarFotos(categoriaAtual, true);
    carregarTimeline();
    carregarMetas();
    carregarEstatisticas();
    iniciarObservadorNotificacoes();
    carregarNotificacoesNaoLidas();
    iniciarChat();
    carregarPreferencias();
}

function trocarPerfil() {
    usuarioAtual = null;
    localStorage.removeItem('usuarioAtual');
    document.getElementById('perfilSeletor').style.display = 'block';
    document.getElementById('usuarioAtual').style.display  = 'none';
    if (unsubscribeChat) unsubscribeChat();
}

// ==================== CHUVA DE CORAÇÕES ====================
let chuvaAtiva = false;
function iniciarChuvaCorações(duracaoMs = 5000) {
    if (chuvaAtiva) return;
    chuvaAtiva = true;
    let container = document.getElementById('heartRainContainer');
    if (!container) {
        container = document.createElement('div');
        container.id        = 'heartRainContainer';
        container.className = 'heart-rain';
        document.body.appendChild(container);
    }
    container.innerHTML  = '';
    const symbols   = ['❤️','💖','💗','💓','💕','💞','💘','💝'];
    const interval  = setInterval(() => {
        if (!chuvaAtiva) return;
        for (let i = 0; i < Math.floor(Math.random() * 6) + 3; i++) {
            const h       = document.createElement('div');
            h.className   = 'heart';
            h.textContent = symbols[Math.floor(Math.random() * symbols.length)];
            h.style.cssText = `font-size:${Math.random()*20+15}px;left:${Math.random()*100}%;animation-duration:${Math.random()*3+2}s`;
            container.appendChild(h);
            setTimeout(() => h.remove(), 5000);
        }
    }, 200);
    setTimeout(() => { clearInterval(interval); setTimeout(() => { container.innerHTML = ''; chuvaAtiva = false; }, 1000); }, duracaoMs);
}

function mostrarBannerDataEspecial(mensagem) {
    const banner     = document.createElement('div');
    banner.className = 'special-date-banner';
    banner.innerHTML = `🎉 ${mensagem} 🎉`;
    banner.onclick   = () => { iniciarChuvaCorações(5000); banner.remove(); };
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 10000);
}

// ==================== INICIALIZAÇÃO PRINCIPAL ====================
document.addEventListener('DOMContentLoaded', () => {
    // Google APIs
    initTokenClient();
    initGapi();

    // Spotify
    initSpotify();

    // Modo surpresa persistido
    if (localStorage.getItem('modoSurpresa') === 'true') alternarModoSurpresa();
    document.getElementById('surpresaBtn')?.addEventListener('click', alternarModoSurpresa);

    // Tema noturno
    const toggleThemeBtn = document.getElementById('toggleThemeBtn');
    if (toggleThemeBtn) {
        if (localStorage.getItem('modoNoturno') === 'true') {
            document.body.classList.add('modo-noturno');
            toggleThemeBtn.textContent = '☀️ Modo Claro';
        }
        toggleThemeBtn.addEventListener('click', () => {
            document.body.classList.toggle('modo-noturno');
            const noturno = document.body.classList.contains('modo-noturno');
            localStorage.setItem('modoNoturno', noturno);
            toggleThemeBtn.textContent = noturno ? '☀️ Modo Claro' : '🌙 Modo Noturno';
        });
    }

    // Referências DOM
    seriesList           = document.getElementById('listaSeries');
    adicionarSerieBtn    = document.getElementById('adicionarSerieBtn');
    viagensList          = document.getElementById('listaViagens');
    adicionarViagemBtn   = document.getElementById('adicionarViagemBtn');
    albumGrid            = document.getElementById('albumGrid');
    botoesCategoria      = document.querySelectorAll('.cat-btn');
    adicionarFotoBtn     = document.getElementById('adicionarFotoBtn');
    carregarMaisBtn      = document.getElementById('carregarMaisBtn');
    ordenacaoAlbum       = document.getElementById('ordenacaoAlbum');
    filtroData           = document.getElementById('filtroData');
    timelineList         = document.getElementById('listaTimeline');
    adicionarTimelineBtn = document.getElementById('adicionarTimelineBtn');
    metasList            = document.getElementById('listaMetas');
    adicionarMetaBtn     = document.getElementById('adicionarMetaBtn');

    iniciarSlideshow();

    // FIX #2: adicionarSerieBtn agora tem listener
    adicionarSerieBtn?.addEventListener('click', adicionarSerieDialog);
    adicionarViagemBtn?.addEventListener('click', adicionarViagemDialog);
    adicionarMetaBtn?.addEventListener('click', adicionarMetaDialog);
    adicionarTimelineBtn?.addEventListener('click', mostrarFormularioTimeline);

    // Adicionar foto
    adicionarFotoBtn?.addEventListener('click', () => {
        if (usuarioAtual !== 'alexandre') { alert('Apenas Alexandre pode adicionar mídias.'); return; }
        mostrarDialogo('📷 Adicionar Foto', `
            <label>Legenda</label><input type="text" id="legendaFoto">
            <label>Localização (opcional)</label>
            <input type="text" id="localizacaoFoto" list="locaisSugestoes" placeholder="Ex: Praia do Futuro, Fortaleza">
            <datalist id="locaisSugestoes"></datalist>
            <label>Imagem *</label><input type="file" id="imagemFoto" accept="image/*" required>
        `, async form => {
            const legenda     = form.querySelector('#legendaFoto').value.trim();
            const localizacao = form.querySelector('#localizacaoFoto').value.trim();
            const file        = form.querySelector('#imagemFoto').files[0];
            if (!file) throw new Error('Selecione uma imagem');
            const url         = await uploadParaImgBB(file);
            const coordenadas = localizacao ? await obterCoordenadas(localizacao) : null;
            await addDoc(collection(db, 'fotos'), {
                categoria: categoriaAtual, url, legenda,
                localizacao: localizacao || null,
                coordenadas: coordenadas || null,
                dataEnvio: new Date(), enviadoPor: usuarioAtual, tipo: 'image'
            });
            carregarFotos(categoriaAtual, true);
            iniciarSlideshow();
        });

        // Autocomplete de localização
        setTimeout(() => {
            const input    = document.getElementById('localizacaoFoto');
            const datalist = document.getElementById('locaisSugestoes');
            if (!input) return;
            input.addEventListener('input', async e => {
                const termo = e.target.value.trim();
                if (debounceTimeout) clearTimeout(debounceTimeout);
                if (termo.length < 2) { datalist.innerHTML = ''; return; }
                debounceTimeout = setTimeout(async () => {
                    const sug = await buscarSugestoesLocal(termo);
                    datalist.innerHTML = sug.map(s => `<option value="${escapeHtml(s)}">`).join('');
                }, 500);
            });
        }, 100);
    });

    // Categorias do álbum
    botoesCategoria.forEach(btn => {
        btn.addEventListener('click', () => {
            botoesCategoria.forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            categoriaAtual = btn.dataset.cat;
            carregarFotos(categoriaAtual, true);
        });
    });

    carregarMaisBtn?.addEventListener('click', () => carregarFotos(categoriaAtual, false));
    ordenacaoAlbum?.addEventListener('change', () => { aplicarOrdenacaoEFiltro(); salvarPreferencias(); });
    filtroData?.addEventListener('change', aplicarOrdenacaoEFiltro);

    // FIX #5: Fechar modais — cada botão .fechar fecha seu próprio modal pai
    document.querySelectorAll('.fechar').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });

    // Fechar modal principal ao clicar no backdrop
    window.addEventListener('click', e => {
        ['modal', 'modalDetalhesEvento'].forEach(id => {
            const el = document.getElementById(id);
            if (e.target === el) el.style.display = 'none';
        });
    });

    // Lightbox
    document.getElementById('lightboxPrev')?.addEventListener('click', prevImage);
    document.getElementById('lightboxNext')?.addEventListener('click', nextImage);
    document.getElementById('lightboxFechar')?.addEventListener('click', () => {
        document.getElementById('lightboxModal').style.display = 'none';
    });

    // Fechar com teclado
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            // Fecha o modal de diálogo nativo se aberto
            const dialog = document.getElementById('genericDialog');
            if (dialog?.open) { dialog.close(); return; }
            fecharModal(); // Fecha todos os modais
        }
        if (e.key === 'ArrowRight') nextImage();
        if (e.key === 'ArrowLeft')  prevImage();
    });

    // Perfil
    const salvoPerfil = localStorage.getItem('usuarioAtual');
    if (salvoPerfil === 'alexandre' || salvoPerfil === 'ana') {
        selecionarPerfil(salvoPerfil);
    } else {
        document.querySelectorAll('.perfil-btn').forEach(btn =>
            btn.addEventListener('click', e => selecionarPerfil(e.currentTarget.dataset.perfil))
        );
    }
    document.getElementById('trocarPerfilBtn')?.addEventListener('click', trocarPerfil);

    // Ações do header
    document.getElementById('compartilharBtn')?.addEventListener('click', compartilharAvancado);
    document.getElementById('backupBtn')?.addEventListener('click', exportarBackup);
    document.getElementById('compartilharLinkBtn')?.addEventListener('click', compartilharLink);
    document.getElementById('notificacaoIcone')?.addEventListener('click', exibirListaNotificacoes);
    document.getElementById('importarBtn')?.addEventListener('click', exibirModalImportar);

    // Busca global
    document.getElementById('globalSearchInput')?.addEventListener('input', e => realizarBuscaGlobal(e.target.value));

    // Tema de cor
    document.getElementById('temaCorSelect')?.addEventListener('change', e => { aplicarTema(e.target.value); salvarPreferencias(); });

    // Chat
    const chatInput    = document.getElementById('chatInput');
    const enviarMsgBtn = document.getElementById('enviarMsgBtn');
    enviarMsgBtn?.addEventListener('click', () => { enviarMensagem(chatInput?.value || ''); if (chatInput) chatInput.value = ''; });
    chatInput?.addEventListener('keypress', e => { if (e.key === 'Enter') enviarMsgBtn?.click(); });

    // Mapa mundial
    document.getElementById('mapaMundiBtn')?.addEventListener('click', async () => {
        document.getElementById('modalMapa').style.display = 'flex';
        await inicializarMapa();
        setTimeout(async () => { await carregarLocaisNoMapa(); mapa?.invalidateSize(); }, 200);
    });
    document.getElementById('fecharMapa')?.addEventListener('click', () => {
        document.getElementById('modalMapa').style.display = 'none';
        if (mapa) { mapa.remove(); mapa = null; mapaInicializado = false; }
    });
    document.getElementById('traçarRotaBtn')?.addEventListener('click', tracarRotaEntreLocais);

    // Inicializações finais
    inicializarNavegacao();
    verificarDataEspecialComFirestore();
    verificarLembretesDatas();
    solicitarPermissaoNotificacoes();
    initMusicPlayerLocal();
    carregarNotificacoesNaoLidas();
});