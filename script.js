// ==================== CONFIGURAÇÃO GLOBAL PARA SPOTIFY (EVITA ERRO) ====================
window.onSpotifyWebPlaybackSDKReady = function() {
    console.log("Spotify SDK ready, mas integração desativada.");
};

// ==================== IMPORTAÇÕES ====================
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, setDoc, where, deleteDoc, updateDoc, onSnapshot, limit, startAfter } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const db = window.db;
if (!db) console.error("❌ Firestore não inicializado!");

// ==================== CONFIGURAÇÕES ====================
const DATA_INICIO = new Date(2025, 7, 11, 21, 46, 0);
let usuarioAtual = null;
const IMGBB_API_KEY = "6fb524bd462f38196629ff83d4b594fa";
const avaliacaoImgs = {
    1: "https://i.ibb.co/QjQdgswz/download-9.jpg",
    2: "https://i.ibb.co/B57j8S4F/images-4.jpg",
    3: "https://i.ibb.co/V1Y71LQ/4250574.png",
    4: "https://i.ibb.co/TxLjwPHx/happy-cat-dance-hapi-cute-260nw-2308472719.webp",
    5: "https://i.ibb.co/RkTMbKG3/absolute-pompompurin.png"
};

let categoriaAtual = "nossos-meses";
let seriesList, adicionarSerieBtn, viagensList, adicionarViagemBtn;
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
let ultimoDocFoto = null;
let todasFotosCache = [];

// ==================== CONFIGURAÇÕES DO GOOGLE DRIVE ====================
const GOOGLE_CLIENT_ID = '241579865765-ak7eabusfoqi5fp639ts6n5umn17rsva.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'SUA_API_KEY_AQUI';      
const GOOGLE_APP_ID = '241579865765';            
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let tokenClient;
let accessToken = null;
let pickerInited = false;
let gisInited = false;

// ==================== MODO SURPRESA ====================
let modoSurpresa = false;
function alternarModoSurpresa() {
    modoSurpresa = !modoSurpresa;
    if (modoSurpresa) {
        document.body.classList.add('modo-surpresa');
        const anos = Math.floor((new Date() - DATA_INICIO) / (1000 * 60 * 60 * 24 * 365));
        const contador = document.querySelector('.contador');
        if (contador) contador.setAttribute('data-anos', anos);
    } else {
        document.body.classList.remove('modo-surpresa');
    }
    localStorage.setItem('modoSurpresa', modoSurpresa);
}

// ==================== FUNÇÕES DO GOOGLE DRIVE ====================
function gapiLoaded() {
    console.log("gapi loaded");
    gapi.load('client:picker', initializePicker);
}

function gisLoaded() {
    console.log("gis loaded");
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: '', 
    });
    gisInited = true;
    maybeEnableButtons();
}

async function initializePicker() {
    await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');
    pickerInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (pickerInited && gisInited) {
        console.log("Picker e GIS prontos!");
    }
}

function handleGoogleDriveAuth() {
    if (accessToken === null) {
        tokenClient.callback = async (response) => {
            if (response.error !== undefined) throw response;
            accessToken = response.access_token;
            createPicker();
        };
        tokenClient.requestAccessToken();
    } else {
        createPicker();
    }
}

async function createPicker() {
    if (!accessToken) {
        console.error("Sem token de acesso");
        return;
    }
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes("image/jpeg,image/png,image/gif,image/webp,image/bmp");

    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setAppId(GOOGLE_APP_ID)
        .setOAuthToken(accessToken)
        .addView(view)
        .addView(new google.picker.DocsUploadView())
        .setCallback(pickerCallback)
        .build();
    picker.setVisible(true);
}

async function pickerCallback(data) {
    if (data.action === google.picker.Action.PICKED) {
        const docs = data.docs;
        const statusDiv = document.getElementById('importStatus');
        if (statusDiv) statusDiv.innerHTML = "⏳ Importando...";

        for (const doc of docs) {
            try {
                const response = await fetch(`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (!response.ok) throw new Error(`Erro ao baixar ${doc.name}`);
                const blob = await response.blob();
                const file = new File([blob], doc.name, { type: blob.type });
                const url = await uploadParaImgBB(file);
                if (!url) throw new Error("Falha no upload para ImgBB");

                await addDoc(collection(db, 'fotos'), {
                    categoria: categoriaAtual,
                    url: url,
                    legenda: `Importada do Drive: ${doc.name}`,
                    dataEnvio: new Date(),
                    enviadoPor: usuarioAtual,
                    tipo: 'image'
                });
            } catch (err) {
                console.error(`Erro com ${doc.name}:`, err);
                if (statusDiv) statusDiv.innerHTML = `⚠️ Erro em ${doc.name}. Continue tentando.`;
            }
        }
        carregarFotos(categoriaAtual, true);
        iniciarSlideshow();
        if (statusDiv) statusDiv.innerHTML = "✅ Importação concluída!";
        fecharModal();
    } else if (data.action === google.picker.Action.CANCEL) {
        const statusDiv = document.getElementById('importStatus');
        if (statusDiv) statusDiv.innerHTML = "❌ Cancelado.";
    }
}

// ==================== IMPORTAR FOTOS ====================
function exibirModalImportar() {
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;
    modalBody.innerHTML = `
        <h2>📥 Importar fotos</h2>
        <p style="margin-bottom: 1rem;">Selecione a origem:</p>
        <button id="importGoogleDriveBtn" class="btn-admin">📁 Google Drive</button>
        <button id="importInstagramBtn" class="btn-admin">📸 Instagram (em breve)</button>
        <div id="importStatus" style="margin-top: 1rem;"></div>
    `;
    document.getElementById('modal').style.display = 'flex';

    const driveBtn = document.getElementById('importGoogleDriveBtn');
    if (driveBtn) driveBtn.onclick = () => handleGoogleDriveAuth();

    const instaBtn = document.getElementById('importInstagramBtn');
    if (instaBtn) instaBtn.onclick = () => {
        const statusDiv = document.getElementById('importStatus');
        if (statusDiv) statusDiv.innerHTML = "⚠️ Instagram ainda não integrado. Use upload manual.";
    };
}

// ==================== INTEGRAÇÃO SPOTIFY (DESATIVADA) ====================
function iniciarSpotify() {
    alert("Integração com Spotify requer configuração adicional (Client ID e backend). Por enquanto, use o player local.");
    console.warn("Spotify não configurado.");
}
function extrairTokenSpotify() {}

// ==================== FUNÇÕES AUXILIARES ====================
async function uploadParaImgBB(file) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('key', IMGBB_API_KEY);
    const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
    const data = await response.json();
    if (data.success) return data.data.url;
    else throw new Error('ImgBB: ' + data.error.message);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

function fecharModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.style.display = 'none';
    const lightbox = document.getElementById('lightboxModal');
    if (lightbox) lightbox.style.display = 'none';
}

function formatarDataBR(dataString) {
    if (!dataString) return 'Data não definida';
    const data = new Date(dataString);
    if (isNaN(data.getTime())) return dataString;
    return data.toLocaleDateString('pt-BR');
}

async function buscarSugestoesLocal(termo) {
    if (!termo || termo.length < 2) return [];
    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}&limit=5&addressdetails=1&accept-language=pt`);
        const data = await resp.json();
        return data.map(item => item.display_name);
    } catch (err) { return []; }
}

async function obterCoordenadas(endereco) {
    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endereco)}&limit=1`);
        const data = await resp.json();
        if (data && data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        return null;
    } catch (err) { return null; }
}

async function salvarPreferencias() {
    if (!usuarioAtual) return;
    const tema = document.getElementById('temaCorSelect')?.value || 'rosa';
    const ordenacao = document.getElementById('ordenacaoAlbum')?.value || 'recente';
    await setDoc(doc(db, 'preferencias', usuarioAtual), { tema, ordenacao });
}
async function carregarPreferencias() {
    if (!usuarioAtual) return;
    const snap = await getDoc(doc(db, 'preferencias', usuarioAtual));
    if (snap.exists()) {
        const pref = snap.data();
        if (document.getElementById('temaCorSelect')) document.getElementById('temaCorSelect').value = pref.tema || 'rosa';
        if (document.getElementById('ordenacaoAlbum')) document.getElementById('ordenacaoAlbum').value = pref.ordenacao || 'recente';
        aplicarTema(pref.tema || 'rosa');
    }
}
function aplicarTema(cor) {
    document.body.classList.remove('tema-rosa', 'tema-roxo', 'tema-azul');
    document.body.classList.add(`tema-${cor}`);
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('Service Worker não encontrado (opcional)', err));
}

function compartilharLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    alert("Link copiado! Compartilhe com quem quiser 💕");
}

function iniciarChat() {
    if (!usuarioAtual) return;
    if (unsubscribeChat) unsubscribeChat();
    const q = query(collection(db, 'mensagens'), orderBy('timestamp', 'asc'));
    unsubscribeChat = onSnapshot(q, (snap) => {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        container.innerHTML = '';
        snap.forEach(docMsg => {
            const msg = docMsg.data();
            const div = document.createElement('div');
            div.className = `chat-mensagem ${msg.autor}`;
            div.innerHTML = `<strong>${msg.autor === 'alexandre' ? 'Alexandre' : 'Ana'}</strong><br>${escapeHtml(msg.texto)}<br><small>${new Date(msg.timestamp?.toDate()).toLocaleTimeString()}</small>`;
            container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
    });
}
async function enviarMensagem(texto) {
    if (!texto.trim() || !usuarioAtual) return;
    await addDoc(collection(db, 'mensagens'), { texto: texto.trim(), autor: usuarioAtual, timestamp: new Date() });
}

async function carregarEvolucao() {
    const fotosSnap = await getDocs(collection(db, 'fotos'));
    const meses = {};
    fotosSnap.forEach(doc => {
        const data = doc.data().dataEnvio?.toDate();
        if (data) {
            const chave = `${data.getFullYear()}-${data.getMonth()+1}`;
            meses[chave] = (meses[chave] || 0) + 1;
        }
    });
    const labels = Object.keys(meses).sort();
    const dados = labels.map(l => meses[l]);
    const ctx = document.getElementById('evolucaoChart')?.getContext('2d');
    if (ctx) {
        if (charts.evolucao) charts.evolucao.destroy();
        charts.evolucao = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: 'Fotos por mês', data: dados, borderColor: '#b83b5e', tension: 0.3 }] } });
    }
}

async function criarNotificacao(tipo, entidadeId, entidadeNome, acao) {
    if (!usuarioAtual) return;
    const notificacao = { tipo, entidadeId, entidadeNome, acao, autor: usuarioAtual, destinatario: usuarioAtual === 'alexandre' ? 'ana' : 'alexandre', data: new Date(), lida: false };
    try { await addDoc(collection(db, 'notificacoes'), notificacao); } catch (err) { console.warn("Erro ao criar notificação:", err); }
}
async function carregarNotificacoesNaoLidas() {
    if (!usuarioAtual) return 0;
    const q = query(collection(db, 'notificacoes'), where('destinatario', '==', usuarioAtual), where('lida', '==', false));
    const snap = await getDocs(q);
    const badge = document.getElementById('notificacaoBadge');
    if (badge) {
        badge.innerText = snap.size;
        badge.style.display = snap.size > 0 ? 'inline-block' : 'none';
    }
    return snap.size;
}
async function exibirListaNotificacoes() {
    if (!usuarioAtual) return;
    const q = query(collection(db, 'notificacoes'), where('destinatario', '==', usuarioAtual), orderBy('data', 'desc'));
    const snap = await getDocs(q);
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;
    let html = '<h2>🔔 Notificações</h2><div class="notificacao-lista" style="position:static; width:100%;">';
    if (snap.empty) html += '<p>Nenhuma notificação.</p>';
    snap.forEach(docNotif => {
        const n = docNotif.data();
        html += `<div class="notificacao-item ${n.lida ? '' : 'nao-lida'}" data-id="${docNotif.id}"><strong>${n.autor === 'alexandre' ? 'Alexandre' : 'Ana'}</strong> ${n.acao} "${escapeHtml(n.entidadeNome)}" (${n.tipo})<br><small>${new Date(n.data?.toDate()).toLocaleString()}</small></div>`;
    });
    html += '</div><button id="marcarTodasLidas" class="btn-admin">Marcar todas como lidas</button>';
    modalBody.innerHTML = html;
    document.getElementById('modal').style.display = 'flex';
    document.querySelectorAll('.notificacao-item').forEach(el => {
        el.addEventListener('click', async () => {
            await updateDoc(doc(db, 'notificacoes', el.dataset.id), { lida: true });
            exibirListaNotificacoes();
        });
    });
    const btnMarcar = document.getElementById('marcarTodasLidas');
    if (btnMarcar) {
        btnMarcar.onclick = async () => {
            const batch = [];
            snap.forEach(docNotif => batch.push(updateDoc(doc(db, 'notificacoes', docNotif.id), { lida: true })));
            await Promise.all(batch);
            exibirListaNotificacoes();
        };
    }
}
function iniciarObservadorNotificacoes() {
    if (!usuarioAtual) return;
    if (unsubscribeNotificacoes) unsubscribeNotificacoes();
    const q = query(collection(db, 'notificacoes'), where('destinatario', '==', usuarioAtual), orderBy('data', 'desc'));
    unsubscribeNotificacoes = onSnapshot(q, (snap) => {
        const badge = document.getElementById('notificacaoBadge');
        if (!badge) return;
        const naoLidas = snap.docs.filter(doc => !doc.data().lida).length;
        badge.innerText = naoLidas;
        badge.style.display = naoLidas > 0 ? 'inline-block' : 'none';
    }, (error) => {
        console.error("Erro no observador de notificações:", error);
    });
}

async function compartilharAvancado() {
    const contadorDiv = document.querySelector('.contador');
    if (!contadorDiv) return;
    try {
        const fotosSnap = await getDocs(collection(db, 'fotos'));
        const fotos = fotosSnap.docs.map(doc => doc.data().url).filter(u => u && !u.includes('placehold'));
        let imagemFundo = '';
        if (fotos.length) imagemFundo = fotos[Math.floor(Math.random() * fotos.length)];
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fde4e8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (imagemFundo) {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            await new Promise((resolve) => {
                img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, canvas.width, canvas.height); resolve(); };
                img.src = imagemFundo;
            });
        }
        ctx.font = 'bold 40px "Playfair Display"';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('✨ Nosso Tempo ✨', canvas.width/2 - 150, 100);
        ctx.font = '30px "Poppins"';
        ctx.fillText(`Juntos há ${document.getElementById('meses')?.innerText || '0'} meses`, canvas.width/2 - 180, 200);
        const imageData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'nosso-tempo-share.png';
        link.href = imageData;
        link.click();
        alert("Imagem gerada e salva! 💕");
    } catch (err) { alert("Erro ao gerar imagem."); }
}

async function exportarBackup() {
    if (!usuarioAtual) return;
    const colecoes = ['fotos', 'series', 'episodios', 'avaliacoes', 'comentarios', 'viagens', 'locais', 'fotosViagens', 'metas', 'timeline', 'datasEspeciais', 'notificacoes', 'mensagens', 'preferencias'];
    const backup = {};
    for (const colecao of colecoes) {
        const snap = await getDocs(collection(db, colecao));
        backup[colecao] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup_${usuarioAtual}_${new Date().toISOString().slice(0,19)}.json`;
    a.click();
    alert("Backup exportado com sucesso!");
}

function realizarBuscaGlobal(termo) {
    if (!termo || termo.length < 2) {
        carregarFotos(categoriaAtual, true);
        carregarSeries();
        carregarViagens();
        carregarMetas();
        carregarTimeline();
        return;
    }
    termo = termo.toLowerCase();
    document.querySelectorAll('#albumGrid .card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(termo) ? '' : 'none');
    document.querySelectorAll('#listaSeries .card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(termo) ? '' : 'none');
    document.querySelectorAll('#listaViagens .card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(termo) ? '' : 'none');
    document.querySelectorAll('#listaMetas .card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(termo) ? '' : 'none');
    document.querySelectorAll('#listaTimeline .timeline-card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(termo) ? '' : 'none');
}

let fotoUrlsLightbox = [];
let lightboxIndex = 0;
function abrirLightbox(fotosArray, index) {
    fotoUrlsLightbox = fotosArray.filter(f => f.tipo !== 'video').map(f => f.url);
    if (fotoUrlsLightbox.length === 0) return;
    lightboxIndex = Math.min(index, fotoUrlsLightbox.length - 1);
    const modal = document.getElementById('lightboxModal');
    const img = document.getElementById('lightboxImg');
    const caption = document.getElementById('lightboxCaption');
    if (!modal || !img) return;
    img.src = fotoUrlsLightbox[lightboxIndex];
    if (caption) caption.innerText = fotosArray[index]?.legenda || '';
    modal.style.display = 'flex';
}
function nextImage() {
    if (fotoUrlsLightbox.length === 0) return;
    lightboxIndex = (lightboxIndex + 1) % fotoUrlsLightbox.length;
    const img = document.getElementById('lightboxImg');
    if (img) img.src = fotoUrlsLightbox[lightboxIndex];
}
function prevImage() {
    if (fotoUrlsLightbox.length === 0) return;
    lightboxIndex = (lightboxIndex - 1 + fotoUrlsLightbox.length) % fotoUrlsLightbox.length;
    const img = document.getElementById('lightboxImg');
    if (img) img.src = fotoUrlsLightbox[lightboxIndex];
}

function inicializarCalendario(eventos) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    if (calendar) calendar.destroy();
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        events: eventos.map(e => ({ title: e.titulo, start: e.dataEvento, description: e.descricao, url: e.fotos?.[0] || '' })),
        eventClick: (info) => {
            abrirModalDetalhesEvento({ titulo: info.event.title, dataEvento: info.event.startStr, descricao: info.event.extendedProps.description, fotos: info.event.url ? [info.event.url] : [] });
            info.jsEvent.preventDefault();
        }
    });
    calendar.render();
}

async function carregarEstatisticas() {
    const fotosSnap = await getDocs(collection(db, 'fotos'));
    const categorias = {};
    fotosSnap.forEach(doc => { const cat = doc.data().categoria; categorias[cat] = (categorias[cat] || 0) + 1; });
    if (charts.fotosChart) charts.fotosChart.destroy();
    const ctxFotos = document.getElementById('fotosPorCategoriaChart')?.getContext('2d');
    if (ctxFotos) charts.fotosChart = new Chart(ctxFotos, { type: 'bar', data: { labels: Object.keys(categorias), datasets: [{ label: 'Fotos', data: Object.values(categorias), backgroundColor: '#b83b5e' }] } });
    
    const metasSnap = await getDocs(collection(db, 'metas'));
    let concluidas = 0, pendentes = 0;
    metasSnap.forEach(doc => { doc.data().concluida ? concluidas++ : pendentes++; });
    if (charts.metasChart) charts.metasChart.destroy();
    const ctxMetas = document.getElementById('metasStatusChart')?.getContext('2d');
    if (ctxMetas) charts.metasChart = new Chart(ctxMetas, { type: 'pie', data: { labels: ['Concluídas', 'Pendentes'], datasets: [{ data: [concluidas, pendentes], backgroundColor: ['#2ecc71', '#e74c3c'] }] } });

    const seriesSnap = await getDocs(collection(db, 'series'));
    let seriesCount = 0, filmesCount = 0;
    seriesSnap.forEach(doc => { doc.data().tipo === 'serie' ? seriesCount++ : filmesCount++; });
    if (charts.seriesChart) charts.seriesChart.destroy();
    const ctxSeries = document.getElementById('seriesTipoChart')?.getContext('2d');
    if (ctxSeries) charts.seriesChart = new Chart(ctxSeries, { type: 'doughnut', data: { labels: ['Séries', 'Filmes'], datasets: [{ data: [seriesCount, filmesCount], backgroundColor: ['#3498db', '#f1c40f'] }] } });

    const resumoDiv = document.getElementById('resumoEstatisticas');
    if (resumoDiv) {
        resumoDiv.innerHTML = `
            <p>📸 Total de fotos: ${fotosSnap.size}</p>
            <p>🎯 Metas concluídas: ${concluidas} / ${concluidas+pendentes}</p>
            <p>🎬 Séries/filmes: ${seriesCount+filmesCount}</p>
            <p>✈️ Viagens planejadas: ${(await getDocs(query(collection(db, 'viagens'), where('status', '==', 'planejada')))).size}</p>
            <p>📅 Eventos na linha do tempo: ${(await getDocs(collection(db, 'timeline'))).size}</p>
        `;
    }
    await carregarEvolucao();
}

async function verificarLembretesDatas() {
    const hoje = new Date();
    const datas = await carregarDatasEspeciais();
    for (let i = 1; i <= 3; i++) {
        const futuro = new Date();
        futuro.setDate(hoje.getDate() + i);
        const futuroStr = `${String(futuro.getDate()).padStart(2,'0')}/${String(futuro.getMonth()+1).padStart(2,'0')}`;
        const especial = datas.find(d => d.data === futuroStr);
        if (especial) mostrarBannerDataEspecial(`📅 Em ${i} dia(s): ${especial.descricao}`, true);
    }
}
function solicitarPermissaoNotificacoes() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') Notification.requestPermission();
}

let elsContador = { meses: null, semanas: null, dias: null, horas: null, minutos: null, segundos: null };
function atualizarContador() {
    if (!elsContador.meses) {
        elsContador.meses = document.getElementById('meses');
        elsContador.semanas = document.getElementById('semanas');
        elsContador.dias = document.getElementById('dias');
        elsContador.horas = document.getElementById('horas');
        elsContador.minutos = document.getElementById('minutos');
        elsContador.segundos = document.getElementById('segundos');
    }
    if (elsContador.meses && elsContador.semanas && elsContador.dias &&
        elsContador.horas && elsContador.minutos && elsContador.segundos) {
        const agora = new Date();
        let diff = agora - DATA_INICIO;
        if (diff < 0) diff = 0;
        elsContador.meses.innerText = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.44));
        elsContador.semanas.innerText = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
        elsContador.dias.innerText = Math.floor(diff / (1000 * 60 * 60 * 24));
        elsContador.horas.innerText = Math.floor(diff / (1000 * 60 * 60));
        elsContador.minutos.innerText = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        elsContador.segundos.innerText = Math.floor((diff % (1000 * 60)) / 1000);
    } else {
        setTimeout(atualizarContador, 100);
    }
}
document.addEventListener('DOMContentLoaded', () => {
    atualizarContador();
    setInterval(atualizarContador, 1000);
});

let slideInterval = null, currentSlide = 0, slidesUrls = [];
async function iniciarSlideshow() {
    if (!db) return;
    try {
        const snap = await getDocs(collection(db, 'fotos'));
        slidesUrls = [];
        snap.forEach(doc => { const url = doc.data().url; if (url && !url.includes('placehold') && doc.data().tipo !== 'video') slidesUrls.push(url); });
        if (slidesUrls.length === 0) return;
        const container = document.getElementById('slideshowContainer');
        if (!container) return;
        container.innerHTML = '';
        slidesUrls.forEach((url, idx) => {
            const img = document.createElement('img');
            img.src = url;
            img.className = 'slide-bg';
            if (idx === 0) img.classList.add('active');
            container.appendChild(img);
        });
        currentSlide = 0;
        if (slideInterval) clearInterval(slideInterval);
        slideInterval = setInterval(() => {
            const slides = document.querySelectorAll('.slide-bg');
            if (slides.length === 0) return;
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }, 8000);
    } catch (err) {}
}

function mostrarDialogo(titulo, camposHtml, aoSalvar) {
    let dialog = document.getElementById('genericDialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'genericDialog';
        document.body.appendChild(dialog);
    }
    dialog.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h2 style="margin:0;">${titulo}</h2>
            <button id="closeDialogBtn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>
        </div>
        <form id="genericForm">
            ${camposHtml}
            <div class="dialog-buttons">
                <button type="submit" class="btn-admin">✅ Salvar</button>
                <button type="button" id="cancelDialogBtn" class="btn-admin" style="background: #6c757d;">Cancelar</button>
            </div>
        </form>
    `;
    dialog.showModal();
    dialog.querySelector('#closeDialogBtn').onclick = () => dialog.close();
    dialog.querySelector('#cancelDialogBtn').onclick = () => dialog.close();
    const form = dialog.querySelector('#genericForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerText;
        submitBtn.innerText = '⏳ Salvando...';
        submitBtn.disabled = true;
        try {
            await aoSalvar(form);
            dialog.close();
        } catch (err) { alert('Erro: ' + err.message); } 
        finally { submitBtn.innerText = originalText; submitBtn.disabled = false; }
    };
    return dialog;
}

async function carregarFotos(categoria, reset = true) {
    if (!db || !albumGrid) return;
    if (reset) { albumGrid.innerHTML = ''; ultimoDocFoto = null; todasFotosCache = []; }
    let q = query(collection(db, 'fotos'), where('categoria', '==', categoria), orderBy('dataEnvio', 'desc'));
    if (ultimoDocFoto) q = query(q, startAfter(ultimoDocFoto), limit(12));
    else q = query(q, limit(12));
    const snap = await getDocs(q);
    if (snap.empty && reset) { albumGrid.innerHTML = '<p>Nenhuma mídia nesta categoria.</p>'; return; }
    const novasFotos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    todasFotosCache.push(...novasFotos);
    ultimoDocFoto = snap.docs[snap.docs.length - 1];
    aplicarOrdenacaoEFiltro();
}
function aplicarOrdenacaoEFiltro() {
    let fotos = [...todasFotosCache];
    const filtro = document.getElementById('filtroData')?.value;
    if (filtro) {
        const [ano, mes] = filtro.split('-');
        fotos = fotos.filter(f => {
            const d = f.dataEnvio?.toDate();
            return d && d.getFullYear() == ano && d.getMonth()+1 == mes;
        });
    }
    const ordenacao = document.getElementById('ordenacaoAlbum')?.value;
    if (ordenacao === 'recente') fotos.sort((a,b) => b.dataEnvio?.toDate() - a.dataEnvio?.toDate());
    else if (ordenacao === 'antigo') fotos.sort((a,b) => a.dataEnvio?.toDate() - b.dataEnvio?.toDate());
    else if (ordenacao === 'az') fotos.sort((a,b) => (a.legenda || '').localeCompare(b.legenda || ''));
    renderizarFotos(fotos);
}
function renderizarFotos(fotosArray) {
    albumGrid.innerHTML = '';
    fotosArray.forEach((foto, idx) => {
        if (!foto.url || foto.url.includes('placehold')) return;
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${foto.url}" loading="lazy">
            <div class="card-content">
                <p>${escapeHtml(foto.legenda || '')}</p>
                ${foto.localizacao ? `<p><small>📍 ${escapeHtml(foto.localizacao)}</small></p>` : ''}
                <small>📅 ${foto.dataEnvio?.toDate().toLocaleDateString('pt-BR') || ''}</small>
                <br><small>👤 ${foto.enviadoPor === 'alexandre' ? 'Alexandre' : 'Ana'}</small>
                ${usuarioAtual === 'alexandre' ? `
                    <div style="margin-top:0.5rem; display:flex; gap:0.5rem;">
                        <button class="editar-foto-btn" data-id="${foto.id}">✏️ Editar</button>
                        <button class="remover-foto-btn" data-id="${foto.id}">🗑️ Remover</button>
                    </div>
                ` : ''}
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (!e.target.classList.contains('editar-foto-btn') && !e.target.classList.contains('remover-foto-btn')) {
                abrirLightbox(fotosArray, idx);
            }
        });
        albumGrid.appendChild(card);
    });
    if (usuarioAtual === 'alexandre') {
        document.querySelectorAll('.editar-foto-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const foto = todasFotosCache.find(f => f.id == id);
                if (!foto) return;
                const novaLegenda = prompt('Nova legenda:', foto.legenda || '');
                const novaLocalizacao = prompt('Nova localização (ou deixe vazio):', foto.localizacao || '');
                let novasCoords = null;
                if (novaLocalizacao && novaLocalizacao.trim()) {
                    novasCoords = await obterCoordenadas(novaLocalizacao);
                }
                await updateDoc(doc(db, 'fotos', id), { legenda: novaLegenda, localizacao: novaLocalizacao || null, coordenadas: novasCoords || null });
                carregarFotos(categoriaAtual, true);
            });
        });
        document.querySelectorAll('.remover-foto-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Remover permanentemente?')) {
                    await deleteDoc(doc(db, 'fotos', btn.dataset.id));
                    carregarFotos(categoriaAtual, true);
                    iniciarSlideshow();
                }
            });
        });
    }
}

async function carregarSeries() {
    if (!db || !seriesList) return;
    const q = query(collection(db, 'series'), orderBy('nome'));
    const querySnapshot = await getDocs(q);
    seriesList.innerHTML = '';
    if (querySnapshot.empty) { seriesList.innerHTML = '<p>Nenhuma série ou filme adicionado ainda.</p>'; return; }
    for (const docSnap of querySnapshot.docs) {
        const serie = docSnap.data();
        const serieId = docSnap.id;
        const avaliacoesQuery = await getDocs(query(collection(db, 'avaliacoes'), where('serieId', '==', serieId)));
        let soma = 0, count = 0;
        avaliacoesQuery.forEach(av => { soma += av.data().nota; count++; });
        const media = count ? (soma / count).toFixed(1) : '?';
        const card = document.createElement('div');
        card.className = 'card';
        let capaURL = serie.capaURL;
        if (!capaURL || capaURL.includes('frame') || capaURL.includes('episodio')) capaURL = 'https://placehold.co/400x200/8B0000/FFF?text=Sem+Imagem';
        card.innerHTML = `
            <img src="${capaURL}" alt="${escapeHtml(serie.nome)}" loading="lazy">
            <div class="card-content">
                <h3>${escapeHtml(serie.nome)}</h3>
                <p>${escapeHtml(serie.sinopse?.substring(0, 80) || '')}...</p>
                <div class="media-exibicao">
                    ${media !== '?' ? '<img src="' + avaliacaoImgs[Math.round(media)] + '" style="width:24px;">' : ''}
                    <span>⭐ ${media}</span>
                </div>
                ${usuarioAtual === 'alexandre' ? '<br><button class="remover-serie-btn" data-id="' + serieId + '">🗑️ Remover série/filme</button>' : ''}
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('remover-serie-btn')) return;
            abrirModalSerie(serieId, serie);
        });
        seriesList.appendChild(card);
    }
    if (usuarioAtual === 'alexandre') {
        document.querySelectorAll('.remover-serie-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const serieId = btn.dataset.id;
                if (confirm('ATENÇÃO: Apagará episódios, avaliações e comentários. Confirmar?')) {
                    const epsSnap = await getDocs(query(collection(db, 'episodios'), where('serieId', '==', serieId)));
                    for (const epDoc of epsSnap.docs) await deleteDoc(doc(db, 'episodios', epDoc.id));
                    await deleteDoc(doc(db, 'series', serieId));
                    carregarSeries();
                }
            });
        });
    }
}

async function abrirModalSerie(serieId, serie) {
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = '<p>⏳ Carregando...</p>';
    document.getElementById('modal').style.display = 'flex';
    try {
        if (!serie.tipo) serie.tipo = 'serie';
        let episodios = [];
        if (serie.tipo === 'serie') {
            const epsQuery = await getDocs(query(collection(db, 'episodios'), where('serieId', '==', serieId), orderBy('numero')));
            episodios = epsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        let avaliacaoUsuario = null;
        if (serie.tipo === 'filme') {
            const avDoc = await getDoc(doc(db, 'avaliacoes', `${serieId}_filme_${usuarioAtual}`));
            if (avDoc.exists()) avaliacaoUsuario = avDoc.data().nota;
        }

        let html = `
            <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem;">
                <img src="${serie.capaURL || 'https://placehold.co/200x300/8B0000/FFF'}" style="width:150px; border-radius:20px;" loading="lazy">
                <div>
                    <h2>${escapeHtml(serie.nome)}</h2>
                    <p><strong>Sinopse:</strong> ${escapeHtml(serie.sinopse || 'Sem sinopse')}</p>
                    <p><strong>Tipo:</strong> ${serie.tipo === 'serie' ? 'Série' : 'Filme'}</p>
                </div>
            </div>
            <hr>
        `;

        if (serie.tipo === 'filme') {
            html += `
                <h3>Avaliar filme</h3>
                <div class="avaliacao-container" id="avaliacaoContainerFilme"></div>
                <div id="mediaFilme" class="media-exibicao" style="margin-top:1rem;"></div>
            `;
        } else {
            html += `<h3>Episódios</h3><div id="episodios-lista"></div>${usuarioAtual === 'alexandre' ? '<button id="adicionarEpisodioBtn" class="btn-admin">+ Adicionar episódio</button>' : ''}`;
        }
        modalBody.innerHTML = html;

        if (serie.tipo === 'filme') {
            const container = document.getElementById('avaliacaoContainerFilme');
            if (container) {
                for (let nota = 1; nota <= 5; nota++) {
                    const btn = document.createElement('button');
                    btn.className = 'avaliacao-btn';
                    if (avaliacaoUsuario === nota) btn.classList.add('selected');
                    btn.innerHTML = `<img src="${avaliacaoImgs[nota]}" title="Nota ${nota}">`;
                    btn.onclick = async () => {
                        await setDoc(doc(db, 'avaliacoes', `${serieId}_filme_${usuarioAtual}`), { nota, serieId, usuario: usuarioAtual, tipo: 'filme', data: new Date() });
                        abrirModalSerie(serieId, serie);
                    };
                    container.appendChild(btn);
                }
            }
            const todasAvaliacoes = await getDocs(query(collection(db, 'avaliacoes'), where('serieId', '==', serieId)));
            let soma = 0, count = 0;
            todasAvaliacoes.forEach(av => { soma += av.data().nota; count++; });
            const media = count ? (soma / count).toFixed(1) : '?';
            const mediaDiv = document.getElementById('mediaFilme');
            if (mediaDiv) mediaDiv.innerHTML = media !== '?' ? `Média: ${media} <img src="${avaliacaoImgs[Math.round(media)]}" style="width:28px;">` : 'Nenhuma avaliação';
        } else {
            const episodiosDiv = document.getElementById('episodios-lista');
            if (episodiosDiv) {
                if (episodios.length === 0) episodiosDiv.innerHTML = '<p>Nenhum episódio adicionado ainda.</p>';
                else {
                    for (let i = 0; i < episodios.length; i++) {
                        const ep = episodios[i];
                        const epDiv = document.createElement('div');
                        epDiv.className = 'episodio-item';
                        epDiv.innerHTML = `<strong>Episódio ${ep.numero}: ${escapeHtml(ep.nome)}</strong><hr>`;
                        episodiosDiv.appendChild(epDiv);
                    }
                }
            }
            if (usuarioAtual === 'alexandre') {
                const addBtn = document.getElementById('adicionarEpisodioBtn');
                if (addBtn) {
                    addBtn.onclick = () => {
                        const numero = prompt('Número do episódio:');
                        const nome = prompt('Nome do episódio:');
                        if (!numero || !nome) return;
                        addDoc(collection(db, 'episodios'), { serieId, numero: parseInt(numero), nome, criadoEm: new Date() }).then(() => abrirModalSerie(serieId, serie));
                    };
                }
            }
        }
    } catch (error) { modalBody.innerHTML = `<p style="color:red;">❌ Erro: ${error.message}</p>`; }
}

// ==================== VIAGENS ====================
async function carregarViagens() {
    if (!db || !viagensList) return;
    try {
        const q = query(collection(db, 'viagens'), where('status', '==', 'planejada'), orderBy('dataPrevista', 'desc'));
        const querySnapshot = await getDocs(q);
        viagensList.innerHTML = '';
        if (querySnapshot.empty) { viagensList.innerHTML = '<p>Nenhuma viagem planejada.</p>'; return; }
        for (const docSnap of querySnapshot.docs) {
            const viagem = docSnap.data();
            const viagemId = docSnap.id;
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-content">
                    <h3>✈️ ${escapeHtml(viagem.nome)}</h3>
                    <p>📅 ${viagem.dataPrevista ? formatarDataBR(viagem.dataPrevista) : 'A definir'}</p>
                    <button class="detalhesViagem" data-id="${viagemId}">Ver locais</button>
                    ${usuarioAtual === 'alexandre' ? `<div style="margin-top: 0.5rem;"><button class="apagarViagemBtn" data-id="${viagemId}" style="background:#8b1e3f;">🗑️ Apagar</button></div>` : ''}
                </div>
            `;
            card.addEventListener('click', (e) => { if (!e.target.classList.contains('apagarViagemBtn')) abrirModalViagem(viagemId); });
            viagensList.appendChild(card);
        }
        if (usuarioAtual === 'alexandre') {
            document.querySelectorAll('.apagarViagemBtn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Apagar esta viagem permanentemente? Todos os locais e fotos serão apagados.')) {
                        const viagemId = btn.dataset.id;
                        const locaisSnap = await getDocs(query(collection(db, 'locais'), where('viagemId', '==', viagemId)));
                        for (const localDoc of locaisSnap.docs) {
                            const fotosSnap = await getDocs(query(collection(db, 'fotosViagens'), where('localId', '==', localDoc.id)));
                            for (const fotoDoc of fotosSnap.docs) await deleteDoc(doc(db, 'fotosViagens', fotoDoc.id));
                            await deleteDoc(doc(db, 'locais', localDoc.id));
                        }
                        await deleteDoc(doc(db, 'viagens', viagemId));
                        carregarViagens();
                    }
                });
            });
        }
    } catch (error) { console.error("Erro ao carregar viagens:", error); }
}

function adicionarLocalDialog(viagemId) {
    mostrarDialogo('📍 Adicionar Local', `
        <label>Nome do local *</label><input type="text" id="localNome" required>
        <label>Endereço (para o mapa) *</label><input type="text" id="localEndereco" required>
        <div id="coordenadasStatus" style="font-size:0.8rem; margin:5px 0;">🔍 Aguardando...</div>
        <label>Descrição</label><textarea id="localDescricao" rows="2"></textarea>
    `, async (form) => {
        const nome = form.querySelector('#localNome').value.trim();
        const endereco = form.querySelector('#localEndereco').value.trim();
        const coordenadas = await obterCoordenadas(endereco);
        await addDoc(collection(db, 'locais'), { viagemId, nome, descricao: form.querySelector('#localDescricao').value.trim(), visitado: false, criadoPor: usuarioAtual, criadoEm: new Date(), coordenadas: coordenadas ? { lat: coordenadas.lat, lng: coordenadas.lng } : null });
        abrirModalViagem(viagemId);
    });
}

// CORREÇÃO: Função Restaurada com a Listagem e Upload de Fotos de Locais
async function abrirModalViagem(viagemId) {
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = '<p>⏳ Carregando detalhes da viagem...</p>';
    document.getElementById('modal').style.display = 'flex';

    try {
        const viagemDoc = await getDoc(doc(db, 'viagens', viagemId));
        if (!viagemDoc.exists()) throw new Error('Viagem não encontrada');
        const viagem = viagemDoc.data();

        const locaisQuery = await getDocs(query(collection(db, 'locais'), where('viagemId', '==', viagemId), orderBy('nome')));
        let locais = locaisQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const todosVisitados = locais.length > 0 && locais.every(l => l.visitado === true);

        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h2>✈️ ${escapeHtml(viagem.nome)}</h2>
                <span class="fechar-interna" style="font-size:2rem; cursor:pointer; color:var(--cor-destaque);">&times;</span>
            </div>
            <p><strong>Data prevista:</strong> ${viagem.dataPrevista ? formatarDataBR(viagem.dataPrevista) : 'Não definida'}</p>
            <hr>
            <h3>Locais para visitar</h3>
            <div id="locais-lista"></div>
            ${usuarioAtual === 'alexandre' ? '<button id="adicionarLocalBtn" class="btn-admin" style="margin-top:1rem;">+ Adicionar local</button>' : ''}
            ${todosVisitados && usuarioAtual === 'alexandre' ? '<button id="arquivarViagemBtn" class="btn-admin" style="margin-top:1rem; background:#28a745;">📦 Arquivar viagem (concluída)</button>' : ''}
        `;
        modalBody.innerHTML = html;
        modalBody.querySelector('.fechar-interna').onclick = fecharModal;

        const locaisDiv = document.getElementById('locais-lista');
        if (locais.length === 0) {
            locaisDiv.innerHTML = '<p>Nenhum local adicionado ainda. Clique em "+ Adicionar local".</p>';
        } else {
            for (const local of locais) {
                const localDiv = document.createElement('div');
                localDiv.className = 'episodio-item';
                localDiv.style.marginBottom = '1.5rem';
                localDiv.innerHTML = `
                    <strong>📍 ${escapeHtml(local.nome)}</strong>
                    ${local.descricao ? `<p>${escapeHtml(local.descricao)}</p>` : ''}
                    ${local.imagemURL ? `<img src="${local.imagemURL}" style="max-width:200px; border-radius:16px; margin:5px 0;" loading="lazy">` : ''}
                    <div>
                        <label>
                            <input type="checkbox" class="local-checkbox" data-id="${local.id}" ${local.visitado ? 'checked disabled' : ''}>
                            Já visitamos este lugar
                        </label>
                    </div>
                    <div class="fotos-local" id="fotos-local-${local.id}">
                        <h5>📸 Fotos deste local</h5>
                        <div class="grid-cards" id="galeria-${local.id}" style="grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:0.5rem;"></div>
                        ${local.visitado || usuarioAtual === 'alexandre' ? `<button class="adicionar-foto-local btn-admin" data-id="${local.id}" style="margin-top:0.5rem; padding:0.3rem 0.8rem;">+ Adicionar foto</button>` : ''}
                    </div>
                `;
                locaisDiv.appendChild(localDiv);

                // Carrega as fotos deste local específico
                const fotosSnap = await getDocs(query(collection(db, 'fotosViagens'), where('localId', '==', local.id), orderBy('data', 'desc')));
                const galeria = localDiv.querySelector(`#galeria-${local.id}`);
                if (fotosSnap.empty) {
                    galeria.innerHTML = '<p>Nenhuma foto ainda.</p>';
                } else {
                    fotosSnap.forEach(fotoDoc => {
                        const foto = fotoDoc.data();
                        const fotoCard = document.createElement('div');
                        fotoCard.className = 'card';
                        fotoCard.style.margin = '0';
                        fotoCard.innerHTML = `
                            <img src="${foto.url}" style="height:100px; object-fit:cover;">
                            <div class="card-content" style="padding:0.3rem;">
                                <small>${escapeHtml(foto.legenda || '')}</small>
                            </div>
                        `;
                        galeria.appendChild(fotoCard);
                    });
                }

                // Eventos de marcar como visitado
                const checkbox = localDiv.querySelector('.local-checkbox');
                if (checkbox && !local.visitado) {
                    checkbox.addEventListener('change', async () => {
                        if (confirm('Marcar este local como visitado? Isso permitirá adicionar fotos.')) {
                            await updateDoc(doc(db, 'locais', local.id), { visitado: true, visitadoPor: usuarioAtual });
                            abrirModalViagem(viagemId); // recarrega a janela
                        } else {
                            checkbox.checked = false;
                        }
                    });
                }

                // Evento de adicionar foto no local
                const addFotoBtn = localDiv.querySelector('.adicionar-foto-local');
                if (addFotoBtn) {
                    addFotoBtn.addEventListener('click', () => {
                        if (!local.visitado && usuarioAtual !== 'alexandre') {
                            alert('Apenas Alexandre pode adicionar fotos antes do local ser marcado como visitado.');
                            return;
                        }
                        const legenda = prompt('Legenda da foto (opcional):');
                        const inputFile = document.createElement('input');
                        inputFile.type = 'file';
                        inputFile.accept = 'image/*';
                        inputFile.onchange = async (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            try {
                                const url = await uploadParaImgBB(file);
                                await addDoc(collection(db, 'fotosViagens'), { localId: local.id, url, legenda: legenda || '', uploader: usuarioAtual, data: new Date() });
                                abrirModalViagem(viagemId); // atualiza a interface
                            } catch (err) { alert('Erro no upload: ' + err.message); }
                        };
                        inputFile.click();
                    });
                }
            }
        }

        if (usuarioAtual === 'alexandre') {
            const addLocalBtn = document.getElementById('adicionarLocalBtn');
            if (addLocalBtn) {
                addLocalBtn.onclick = () => {
                    adicionarLocalDialog(viagemId);
                };
            }
        }

        const arquivarBtn = document.getElementById('arquivarViagemBtn');
        if (arquivarBtn) {
            arquivarBtn.onclick = async () => {
                if (confirm('Arquivar esta viagem como "Realizada"? Ela não aparecerá mais no planejamento.')) {
                    await updateDoc(doc(db, 'viagens', viagemId), { status: 'realizada' });
                    fecharModal();
                    carregarViagens();
                }
            };
        }
    } catch (error) {
        console.error(error);
        modalBody.innerHTML = `<p style="color:red;">❌ Erro: ${error.message}</p>`;
    }
}

function adicionarViagemDialog() {
    mostrarDialogo('✈️ Nova Viagem', `<label>Nome da viagem</label><input type="text" id="nomeViagem" required><label>Data prevista</label><input type="date" id="dataViagem">`, async (form) => {
        const nome = form.querySelector('#nomeViagem').value.trim();
        const data = form.querySelector('#dataViagem').value;
        await addDoc(collection(db, 'viagens'), { nome, dataPrevista: data, criadoPor: usuarioAtual, criadoEm: new Date(), status: 'planejada' });
        carregarViagens();
    });
}

// ==================== METAS ====================
async function carregarMetas() {
    if (!db || !metasList) return;
    try {
        const q = query(collection(db, 'metas'), orderBy('criadoEm', 'desc'));
        const snap = await getDocs(q);
        metasList.innerHTML = '';
        if (snap.empty) { metasList.innerHTML = '<p>Nenhuma meta cadastrada. Clique em "+ Nova meta".</p>'; return; }
        for (const docSnap of snap.docs) {
            const meta = docSnap.data();
            const metaId = docSnap.id;
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-content">
                    <div class="meta-status ${meta.concluida ? 'concluida' : 'pendente'}">${meta.concluida ? '✅ Concluída' : '⏳ Pendente'}</div>
                    <h3>${escapeHtml(meta.titulo)}</h3>
                    <p>${escapeHtml(meta.descricao || '')}</p>
                    ${meta.fotoURL ? `<img src="${meta.fotoURL}" style="width:100%; height:150px; object-fit:cover; border-radius:16px; margin-top:0.5rem;">` : ''}
                    ${usuarioAtual === 'alexandre' ? `
                        <div class="meta-botoes">
                            <button class="concluirMetaBtn" data-id="${metaId}" data-concluida="${meta.concluida}">${meta.concluida ? '↩️ Reabrir' : '✅ Concluir'}</button>
                            <button class="editarMetaBtn" data-id="${metaId}">✏️ Editar</button>
                            <button class="apagarMetaBtn" data-id="${metaId}">🗑️ Apagar</button>
                        </div>
                    ` : ''}
                </div>
            `;
            metasList.appendChild(card);
        }
        if (usuarioAtual === 'alexandre') {
            document.querySelectorAll('.concluirMetaBtn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    const atualmente = btn.dataset.concluida === 'true';
                    await updateDoc(doc(db, 'metas', id), { concluida: !atualmente });
                    carregarMetas();
                });
            });
            document.querySelectorAll('.editarMetaBtn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    const docRef = doc(db, 'metas', id);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const meta = snap.data();
                        const novoTitulo = prompt('Título da meta:', meta.titulo);
                        if (!novoTitulo) return;
                        const novaDescricao = prompt('Descrição:', meta.descricao || '');
                        let fotoURL = meta.fotoURL;
                        const mudarFoto = confirm('Deseja alterar a foto? Cancelar mantém a atual.');
                        if (mudarFoto) {
                            const fileInput = document.createElement('input');
                            fileInput.type = 'file';
                            fileInput.accept = 'image/*';
                            fileInput.onchange = async (ev) => {
                                const file = ev.target.files[0];
                                if (file) fotoURL = await uploadParaImgBB(file);
                                await updateDoc(docRef, { titulo: novoTitulo, descricao: novaDescricao, fotoURL });
                                carregarMetas();
                            };
                            fileInput.click();
                            return;
                        }
                        await updateDoc(docRef, { titulo: novoTitulo, descricao: novaDescricao });
                        carregarMetas();
                    }
                });
            });
            document.querySelectorAll('.apagarMetaBtn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Apagar esta meta permanentemente?')) {
                        await deleteDoc(doc(db, 'metas', btn.dataset.id));
                        carregarMetas();
                    }
                });
            });
        }
    } catch (error) { console.error("Erro ao carregar metas:", error); }
}

function adicionarMetaDialog() {
    mostrarDialogo('🎯 Nova Meta', `
        <label>Título</label><input type="text" id="tituloMeta" required>
        <label>Descrição</label><textarea id="descricaoMeta" rows="2"></textarea>
        <label>Foto ilustrativa (opcional)</label><input type="file" id="fotoMeta" accept="image/*">
    `, async (form) => {
        const titulo = form.querySelector('#tituloMeta').value.trim();
        const descricao = form.querySelector('#descricaoMeta').value.trim();
        const file = form.querySelector('#fotoMeta').files[0];
        let fotoURL = '';
        if (file) fotoURL = await uploadParaImgBB(file);
        await addDoc(collection(db, 'metas'), { titulo, descricao, fotoURL, concluida: false, criadoPor: usuarioAtual, criadoEm: new Date() });
        carregarMetas();
        await criarNotificacao('meta', '', titulo, 'adicionou');
    });
}

// ==================== LINHA DO TEMPO (CORREÇÃO: Museu e Múltiplas Fotos) ====================
function mostrarFormularioTimeline() {
    mostrarDialogo('➕ Novo Evento', `
        <label>Título *</label><input type="text" id="eventoTitulo" required>
        <label>Data *</label><input type="date" id="eventoData" required>
        <label>Descrição</label><textarea id="eventoDescricao" rows="3"></textarea>
        <label>Fotos (Opcional - selecione várias)</label><input type="file" id="eventoFotos" accept="image/*" multiple>
    `, async (form) => {
        const titulo = form.querySelector('#eventoTitulo').value.trim();
        const dataEvento = form.querySelector('#eventoData').value;
        const descricao = form.querySelector('#eventoDescricao').value.trim();
        const files = form.querySelector('#eventoFotos').files;
        
        // Dispara todos os uploads ao mesmo tempo (processamento paralelo)
        let fotosUrls = [];
        if (files.length > 0) {
            const promessasDeUpload = Array.from(files).map(file => uploadParaImgBB(file));
            fotosUrls = await Promise.all(promessasDeUpload);
        }

        await addDoc(collection(db, 'timeline'), { 
            titulo, 
            dataEvento, 
            descricao, 
            fotos: fotosUrls,
            criadoPor: usuarioAtual, 
            criadoEm: new Date() 
        });
        carregarTimeline();
    });
}

async function carregarTimeline() {
    if (!db || !timelineList) return;
    try {
        const q = query(collection(db, 'timeline'), orderBy('dataEvento', 'asc'));
        const snap = await getDocs(q);
        timelineList.innerHTML = '';
        if (snap.empty) { timelineList.innerHTML = '<p>Nenhum evento na linha do tempo ainda.</p>'; return; }
        
        const eventos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Constrói a Barra Horizontal (Estilo Museu)
        const horizontalBar = document.createElement('div');
        horizontalBar.className = 'timeline-horizontal';
        
        const verticalList = document.createElement('div');
        verticalList.className = 'timeline-vertical-list';

        eventos.forEach((evento, index) => {
            // Marcador Horizontal Superior
            const markerH = document.createElement('div');
            markerH.className = 'timeline-marker-h';
            markerH.title = formatarDataBR(evento.dataEvento) + " - " + evento.titulo;
            markerH.dataset.target = `evento-${evento.id}`;
            horizontalBar.appendChild(markerH);
            
            // Linha conectora
            if (index < eventos.length - 1) {
                const lineH = document.createElement('div');
                lineH.className = 'timeline-line-h';
                horizontalBar.appendChild(lineH);
            }

            // O Card Vertical Tradicional
            const card = document.createElement('div');
            card.className = 'timeline-card';
            card.id = `evento-${evento.id}`; // Âncora para o scroll
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            
            let fotosHtml = '';
            if (evento.fotos && evento.fotos.length) {
                fotosHtml = `
                    <div class="timeline-fotos" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
                        ${evento.fotos.map(url => `<img src="${url}" style="width:80px; height:80px; object-fit:cover; border-radius:12px;">`).join('')}
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="timeline-marker"></div>
                <div class="timeline-card-content">
                    <div class="timeline-text">
                        <div class="timeline-data">📅 ${formatarDataBR(evento.dataEvento)}</div>
                        <h3>${escapeHtml(evento.titulo)}</h3>
                        <p>${escapeHtml(evento.descricao || '')}</p>
                    </div>
                    ${fotosHtml}
                    ${usuarioAtual === 'alexandre' ? `<button class="remover-timeline-btn" data-id="${evento.id}" style="background:#8b1e3f; color:white; border:none; border-radius:20px; padding:4px 12px; margin-top:8px; cursor:pointer;">🗑️ Remover evento</button>` : ''}
                </div>
            `;
            verticalList.appendChild(card);

            // Funcionalidade de Scroll do Museu
            markerH.addEventListener('click', () => {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                document.querySelectorAll('.timeline-marker-h').forEach(m => m.classList.remove('active'));
                markerH.classList.add('active');
            });

            // Observador para acender o marcador do topo automaticamente ao descer a tela
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.style.opacity = '1';
                        entry.target.style.transform = 'translateY(0)';
                        document.querySelectorAll('.timeline-marker-h').forEach(m => m.classList.remove('active'));
                        markerH.classList.add('active');
                    }
                });
            }, { threshold: 0.5 });
            observer.observe(card);
        });

        // Injeta os dois blocos na tela
        timelineList.appendChild(horizontalBar);
        timelineList.appendChild(verticalList);

        if (document.getElementById('calendar')) inicializarCalendario(eventos);

        if (usuarioAtual === 'alexandre') {
            document.querySelectorAll('.remover-timeline-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Remover este evento permanentemente?')) {
                        await deleteDoc(doc(db, 'timeline', btn.dataset.id));
                        carregarTimeline();
                    }
                });
            });
        }
    } catch (error) { console.error(error); }
}

function abrirModalDetalhesEvento(evento) {
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `<h2>${escapeHtml(evento.titulo)}</h2><p><strong>Data:</strong> ${formatarDataBR(evento.dataEvento)}</p><p>${escapeHtml(evento.descricao || '')}</p>`;
    document.getElementById('modal').style.display = 'flex';
}

// ==================== PERFIS ====================
function selecionarPerfil(perfil) {
    usuarioAtual = perfil;
    localStorage.setItem('usuarioAtual', perfil);
    document.getElementById('perfilSeletor').style.display = 'none';
    document.getElementById('usuarioAtual').style.display = 'inline-block';
    document.getElementById('nomeUsuario').innerText = perfil === 'alexandre' ? 'Alexandre 🖤' : 'Ana Vitória 💖';
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
    document.getElementById('usuarioAtual').style.display = 'none';
    if (unsubscribeChat) unsubscribeChat();
}

// ==================== DATAS ESPECIAIS ====================
let chuvaAtiva = false, heartsContainer = null;
function iniciarChuvaCorações(duracaoMs = 5000) {
    if (chuvaAtiva) return;
    chuvaAtiva = true;
    if (!heartsContainer) { heartsContainer = document.createElement('div'); heartsContainer.className = 'heart-rain'; document.body.appendChild(heartsContainer); }
    heartsContainer.innerHTML = '';
    const symbols = ['❤️', '💖', '💗', '💓', '💕', '💞', '💘', '💝'];
    const gerar = () => {
        const heart = document.createElement('div');
        heart.className = 'heart';
        heart.innerHTML = symbols[Math.floor(Math.random() * symbols.length)];
        heart.style.fontSize = `${Math.random() * 20 + 15}px`;
        heart.style.left = `${Math.random() * 100}%`;
        heart.style.animationDuration = `${Math.random() * 3 + 2}s`;
        heartsContainer.appendChild(heart);
        setTimeout(() => heart.remove(), 5000);
    };
    const interval = setInterval(() => { if (chuvaAtiva) for (let i = 0; i < Math.floor(Math.random() * 6) + 3; i++) gerar(); }, 200);
    setTimeout(() => { clearInterval(interval); setTimeout(() => { heartsContainer.innerHTML = ''; chuvaAtiva = false; }, 1000); }, duracaoMs);
}
function mostrarBannerDataEspecial(mensagem) {
    const banner = document.createElement('div');
    banner.className = 'special-date-banner';
    banner.innerHTML = `🎉 ${mensagem} 🎉`;
    banner.onclick = () => { iniciarChuvaCorações(5000); banner.remove(); };
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 10000);
}
async function carregarDatasEspeciais() {
    if (!db) return [];
    try { const snap = await getDocs(query(collection(db, 'datasEspeciais'), orderBy('data'))); return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })); } catch { return []; }
}
async function verificarDataEspecialComFirestore() {
    const hoje = new Date();
    const hojeStr = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}`;
    const datas = await carregarDatasEspeciais();
    const especial = datas.find(item => item.data === hojeStr);
    if (especial) { mostrarBannerDataEspecial(especial.descricao); iniciarChuvaCorações(8000); }
}

async function limparMarcadores() {
    if (mapa && currentMarkers.length) { currentMarkers.forEach(marker => mapa.removeLayer(marker)); currentMarkers = []; }
    if (rotaControl) { mapa.removeControl(rotaControl); rotaControl = null; }
}
async function inicializarMapa() {
    if (mapaInicializado) return;
    if (typeof L === 'undefined') { setTimeout(inicializarMapa, 500); return; }
    const container = document.getElementById('mapaContainer');
    if (!container) return;
    mapa = L.map(container).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' }).addTo(mapa);
    mapaInicializado = true;
}
async function tracarRotaEntreLocais() {
    if (!mapa) { await inicializarMapa(); setTimeout(() => tracarRotaEntreLocais(), 500); return; }
    if (rotaControl) mapa.removeControl(rotaControl);
    const locaisSnap = await getDocs(collection(db, 'locais'));
    let locaisComCoords = [];
    for (const docLocal of locaisSnap.docs) {
        const local = docLocal.data();
        if (local.coordenadas && local.coordenadas.lat && local.coordenadas.lng && local.visitado) locaisComCoords.push({ lat: local.coordenadas.lat, lng: local.coordenadas.lng });
    }
    if (locaisComCoords.length < 2) { alert("Precisa de pelo menos dois locais visitados para traçar rota."); return; }
    const waypoints = locaisComCoords.map(l => L.latLng(l.lat, l.lng));
    rotaControl = L.Routing.control({ waypoints, routeWhileDragging: false, lineOptions: { styles: [{ color: '#b83b5e', weight: 4 }] } }).addTo(mapa);
}
async function carregarLocaisNoMapa() {
    if (!mapa) return;
    await limparMarcadores();
    const locaisSnap = await getDocs(collection(db, 'locais'));
    for (const docLocal of locaisSnap.docs) {
        const local = docLocal.data();
        if (local.coordenadas && local.coordenadas.lat && local.coordenadas.lng) {
            const cor = local.visitado ? '#2ecc71' : '#e74c3c';
            const marker = L.marker([local.coordenadas.lat, local.coordenadas.lng], {
                icon: L.divIcon({ html: `<div style="background:${cor}; width:24px; height:24px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:14px;">📍</div>`, iconSize: [24,24], popupAnchor: [0, -12] })
            }).addTo(mapa);
            marker.bindPopup(`<strong>${escapeHtml(local.nome)}</strong><br>Status: ${local.visitado ? '✅ Visitado' : '⏳ Pendente'}`);
            currentMarkers.push(marker);
        }
    }
}

function initMusicPlayerLocal() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeIcon = document.getElementById('volumeIcon');
    if (!playPauseBtn) return;
    audioPlayer = new Audio();
    audioPlayer.loop = true;
    audioPlayer.volume = 0.35;
    audioPlayer.src = 'musica-fundo.mp3';
    document.getElementById('playerTitle').innerText = "Nossa Música Especial";
    document.getElementById('playerChannel').innerText = "Trilha do Nosso Amor";
    document.getElementById('playerThumb').src = "https://media.discordapp.net/attachments/935732645797703681/1465868343838773382/rs.jpg?ex=6a2bfd87&is=6a2aac07&hm=28f71500d17d67cddcbea87e2f2682d58112255e31e8ee01c5cbde8add0242d3&=&format=webp&width=1000&height=800";
    playPauseBtn.onclick = () => {
        if (musicPlaying) { audioPlayer.pause(); playPauseBtn.innerHTML = '▶️'; }
        else { audioPlayer.play().catch(() => {}); playPauseBtn.innerHTML = '⏸️'; }
        musicPlaying = !musicPlaying;
    };
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => { const vol = parseFloat(e.target.value); audioPlayer.volume = vol; if (volumeIcon) volumeIcon.innerText = vol === 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊'; });
    }
    setInterval(() => {
        if (audioPlayer && !isNaN(audioPlayer.duration)) {
            const current = audioPlayer.currentTime;
            const duration = audioPlayer.duration;
            const timeInfo = document.getElementById('timeInfo');
            if (timeInfo) timeInfo.innerText = `${Math.floor(current/60)}:${String(Math.floor(current%60)).padStart(2,'0')} / ${Math.floor(duration/60)}:${String(Math.floor(duration%60)).padStart(2,'0')}`;
        }
    }, 500);
}

function inicializarNavegacao() {
    const abasBtns = document.querySelectorAll('.aba-btn');
    const conteudos = {
        album: document.getElementById('conteudoAlbum'),
        series: document.getElementById('conteudoSeries'),
        viagens: document.getElementById('conteudoViagens'),
        metas: document.getElementById('conteudoMetas'),
        timeline: document.getElementById('conteudoTimeline'),
        calendario: document.getElementById('conteudoCalendario'),
        estatisticas: document.getElementById('conteudoEstatisticas'),
        chat: document.getElementById('conteudoChat'),
        musica: document.getElementById('conteudoMusica'),
        spotify: document.getElementById('conteudoSpotify')
    };
    function ativarAba(abaId) {
        Object.values(conteudos).forEach(c => { if (c) c.style.display = 'none'; });
        if (conteudos[abaId]) conteudos[abaId].style.display = 'block';
        document.querySelectorAll('.aba-btn').forEach(btn => btn.classList.toggle('ativo', btn.dataset.aba === abaId));
        if (abaId === 'calendario' && calendar) calendar.render();
        if (abaId === 'estatisticas') carregarEstatisticas();
    }
    abasBtns.forEach(btn => btn.addEventListener('click', () => ativarAba(btn.dataset.aba)));
    ativarAba('album');
}

// ==================== EVENTO PRINCIPAL ====================
document.addEventListener('DOMContentLoaded', () => {
    // Modo surpresa
    const surpresaBtn = document.getElementById('surpresaBtn');
    if (surpresaBtn) surpresaBtn.addEventListener('click', alternarModoSurpresa);
    if (localStorage.getItem('modoSurpresa') === 'true') alternarModoSurpresa();

    const importarBtn = document.getElementById('importarBtn');
    if (importarBtn) importarBtn.addEventListener('click', exibirModalImportar);

    const toggleThemeBtn = document.getElementById('toggleThemeBtn');
    if (toggleThemeBtn) {
        if (localStorage.getItem('modoNoturno') === 'true') { document.body.classList.add('modo-noturno'); toggleThemeBtn.innerHTML = '☀️ Modo Claro'; }
        toggleThemeBtn.addEventListener('click', () => {
            document.body.classList.toggle('modo-noturno');
            localStorage.setItem('modoNoturno', document.body.classList.contains('modo-noturno'));
            toggleThemeBtn.innerHTML = document.body.classList.contains('modo-noturno') ? '☀️ Modo Claro' : '🌙 Modo Noturno';
        });
    }

    seriesList = document.getElementById('listaSeries');
    adicionarSerieBtn = document.getElementById('adicionarSerieBtn');
    viagensList = document.getElementById('listaViagens');
    adicionarViagemBtn = document.getElementById('adicionarViagemBtn');
    albumGrid = document.getElementById('albumGrid');
    botoesCategoria = document.querySelectorAll('.cat-btn');
    adicionarFotoBtn = document.getElementById('adicionarFotoBtn');
    carregarMaisBtn = document.getElementById('carregarMaisBtn');
    ordenacaoAlbum = document.getElementById('ordenacaoAlbum');
    filtroData = document.getElementById('filtroData');
    timelineList = document.getElementById('listaTimeline');
    adicionarTimelineBtn = document.getElementById('adicionarTimelineBtn');
    metasList = document.getElementById('listaMetas');
    adicionarMetaBtn = document.getElementById('adicionarMetaBtn');

    iniciarSlideshow();
    if (adicionarViagemBtn) adicionarViagemBtn.addEventListener('click', adicionarViagemDialog);
    if (adicionarMetaBtn) adicionarMetaBtn.addEventListener('click', adicionarMetaDialog);
    if (adicionarTimelineBtn) adicionarTimelineBtn.addEventListener('click', () => { if (usuarioAtual !== 'alexandre') return alert('Apenas Alexandre pode adicionar.'); mostrarFormularioTimeline(); });
    
    if (adicionarFotoBtn) {
        adicionarFotoBtn.addEventListener('click', () => {
            if (usuarioAtual !== 'alexandre') return alert('Apenas Alexandre pode adicionar mídias.');
            const dialogHtml = `
                <label>Legenda</label><input type="text" id="legendaFoto">
                <label>Localização (opcional)</label><input type="text" id="localizacaoFoto" list="locaisSugestoes" placeholder="Ex: Praia do Futuro, Fortaleza">
                <datalist id="locaisSugestoes"></datalist>
                <div id="sugestoesStatus" style="font-size:0.8rem; color:gray;"></div>
                <label>Imagem</label><input type="file" id="imagemFoto" accept="image/*" required>
            `;
            mostrarDialogo('📷 Adicionar imagem', dialogHtml, async (form) => {
                const legenda = form.querySelector('#legendaFoto').value.trim();
                const localizacao = form.querySelector('#localizacaoFoto').value.trim();
                const file = form.querySelector('#imagemFoto').files[0];
                if (!file) throw new Error('Selecione uma imagem');
                const url = await uploadParaImgBB(file);
                let coordenadas = null;
                if (localizacao) coordenadas = await obterCoordenadas(localizacao);
                await addDoc(collection(db, 'fotos'), { categoria: categoriaAtual, url, legenda, localizacao: localizacao || null, coordenadas: coordenadas || null, dataEnvio: new Date(), enviadoPor: usuarioAtual, tipo: 'image' });
                carregarFotos(categoriaAtual, true);
                iniciarSlideshow();
            });
            setTimeout(() => {
                const localInput = document.getElementById('localizacaoFoto');
                const datalist = document.getElementById('locaisSugestoes');
                const statusDiv = document.getElementById('sugestoesStatus');
                if (!localInput) return;
                localInput.addEventListener('input', async (e) => {
                    const termo = e.target.value.trim();
                    if (debounceTimeout) clearTimeout(debounceTimeout);
                    if (termo.length < 2) { if (datalist) datalist.innerHTML = ''; if (statusDiv) statusDiv.innerText = ''; return; }
                    if (statusDiv) statusDiv.innerText = '🔍 Buscando...';
                    debounceTimeout = setTimeout(async () => {
                        const sugestoes = await buscarSugestoesLocal(termo);
                        if (datalist) datalist.innerHTML = '';
                        sugestoes.forEach(sug => { const option = document.createElement('option'); option.value = sug; if (datalist) datalist.appendChild(option); });
                        if (statusDiv) statusDiv.innerText = sugestoes.length ? `${sugestoes.length} sugestões encontradas` : 'Nenhuma sugestão';
                    }, 500);
                });
            }, 100);
        });
    }

    if (botoesCategoria.length) {
        botoesCategoria.forEach(btn => {
            btn.addEventListener('click', () => {
                botoesCategoria.forEach(b => b.classList.remove('ativo'));
                btn.classList.add('ativo');
                categoriaAtual = btn.dataset.cat;
                carregarFotos(categoriaAtual, true);
            });
        });
    }
    if (carregarMaisBtn) carregarMaisBtn.addEventListener('click', () => carregarFotos(categoriaAtual, false));
    if (ordenacaoAlbum) ordenacaoAlbum.addEventListener('change', () => { aplicarOrdenacaoEFiltro(); salvarPreferencias(); });
    if (filtroData) filtroData.addEventListener('change', () => aplicarOrdenacaoEFiltro());

    const salvoPerfil = localStorage.getItem('usuarioAtual');
    if (salvoPerfil && (salvoPerfil === 'alexandre' || salvoPerfil === 'ana')) selecionarPerfil(salvoPerfil);
    else document.querySelectorAll('.perfil-btn').forEach(btn => btn.addEventListener('click', (e) => selecionarPerfil(e.target.dataset.perfil)));
    
    const trocarPerfilBtn = document.getElementById('trocarPerfilBtn');
    if (trocarPerfilBtn) trocarPerfilBtn.addEventListener('click', trocarPerfil);
    const fecharBtn = document.querySelector('.fechar');
    if (fecharBtn) fecharBtn.addEventListener('click', fecharModal);
    window.addEventListener('click', (e) => { if (e.target === document.getElementById('modal')) fecharModal(); });
    
    inicializarNavegacao();
    verificarDataEspecialComFirestore();
    verificarLembretesDatas();
    solicitarPermissaoNotificacoes();
    initMusicPlayerLocal();
    carregarNotificacoesNaoLidas();
    
    const compartilharBtn = document.getElementById('compartilharBtn');
    if (compartilharBtn) compartilharBtn.addEventListener('click', compartilharAvancado);
    const backupBtn = document.getElementById('backupBtn');
    if (backupBtn) backupBtn.addEventListener('click', exportarBackup);
    const notificacaoIcone = document.getElementById('notificacaoIcone');
    if (notificacaoIcone) notificacaoIcone.addEventListener('click', exibirListaNotificacoes);
    const globalSearchInput = document.getElementById('globalSearchInput');
    if (globalSearchInput) globalSearchInput.addEventListener('input', (e) => realizarBuscaGlobal(e.target.value));
    const compartilharLinkBtn = document.getElementById('compartilharLinkBtn');
    if (compartilharLinkBtn) compartilharLinkBtn.addEventListener('click', compartilharLink);
    const enviarMsgBtn = document.getElementById('enviarMsgBtn');
    const chatInput = document.getElementById('chatInput');
    if (enviarMsgBtn) enviarMsgBtn.addEventListener('click', () => { enviarMensagem(chatInput?.value || ''); if (chatInput) chatInput.value = ''; });
    if (chatInput) chatInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') enviarMsgBtn?.click(); });
    const temaCorSelect = document.getElementById('temaCorSelect');
    if (temaCorSelect) temaCorSelect.addEventListener('change', (e) => { aplicarTema(e.target.value); salvarPreferencias(); });
    
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxFechar = document.getElementById('lightboxFechar');
    if (lightboxPrev) lightboxPrev.addEventListener('click', prevImage);
    if (lightboxNext) lightboxNext.addEventListener('click', nextImage);
    if (lightboxFechar) lightboxFechar.addEventListener('click', () => document.getElementById('lightboxModal').style.display = 'none');
    
    const mapaBtn = document.getElementById('mapaMundiBtn');
    if (mapaBtn) mapaBtn.addEventListener('click', async () => {
        const modalMapa = document.getElementById('modalMapa');
        if (modalMapa) modalMapa.style.display = 'flex';
        await inicializarMapa();
        setTimeout(async () => { await carregarLocaisNoMapa(); if (mapa) mapa.invalidateSize(); }, 200);
    });
    const fecharMapa = document.getElementById('fecharMapa');
    if (fecharMapa) fecharMapa.addEventListener('click', () => { 
        const modalMapa = document.getElementById('modalMapa');
        if (modalMapa) modalMapa.style.display = 'none';
        if (mapa) mapa.remove();
        mapa = null;
        mapaInicializado = false;
    });
    const tracarRotaBtn = document.getElementById('traçarRotaBtn');
    if (tracarRotaBtn) tracarRotaBtn.addEventListener('click', tracarRotaEntreLocais);
});