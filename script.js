// ==========================================
// CAPSA BANTING MULTIPLAYER (REVISI LOGIKA)
// ==========================================

let peer = null;
let hostConn = null;
let clientConns = [];
let isHost = false;
let myName = "";
let myId = "";
let targetCapacity = 4;

// Game State Data
let players = []; 
let activeTurnIndex = 0;
let lastPlay = null;
let passCount = 0;
let tableCardsPool = []; 
let selectedCardIndices = [];
let gameInProgress = false;
let gamePhase = 'LOBBY'; // 'LOBBY', 'COLLECT_THREES', 'PLAYING'

const suits = ['♣', '♦', '♥', '♠'];
const suitValues = { '♣': 0, '♦': 1, '♥': 2, '♠': 3 };
const rankValues = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
};

window.addEventListener('DOMContentLoaded', () => {
  peer = new Peer();

  peer.on('open', id => {
    myId = id;
    document.getElementById('status').innerText = "Siap! Kode Ruangan Kamu: " + id;
  });

  peer.on('connection', conn => {
    if (!isHost) return;
    if (clientConns.length >= targetCapacity - 1 || gameInProgress) {
      conn.send({ type: 'ERROR', message: 'Ruangan penuh atau permainan sedang berjalan.' });
      setTimeout(() => conn.close(), 500);
      return;
    }

    clientConns.push(conn);
    conn.on('data', data => handleHostData(conn, data));
  });
});

function createRoom() {
  if (!myId) return alert("Jaringan belum siap, tunggu sebentar...");
  isHost = true;
  myName = document.getElementById('username').value.trim() || "Pemain 1";
  targetCapacity = parseInt(document.getElementById('player-capacity').value);

  players = [{ id: myId, name: myName, chips: 1000, cards: [], hasSubmittedThrees: false }];

  navigator.clipboard.writeText(myId);
  document.getElementById('status').innerText = `Ruangan (${targetCapacity} Pemain) dibuat! Kode tersalin. Menunggu pemain lain...`;
  
  updateLobbyUI();
  document.getElementById('btn-host-start').style.display = 'block';
}

function joinRoom() {
  const targetId = document.getElementById('join-id').value.trim();
  if (!targetId) return alert("Masukkan Kode Ruangan Host!");
  
  isHost = false;
  myName = document.getElementById('username').value.trim() || ("Pemain " + Math.floor(Math.random()*100));

  hostConn = peer.connect(targetId);

  hostConn.on('open', () => {
    hostConn.send({ type: 'JOIN', name: myName, id: myId });
    document.getElementById('status').innerText = "Terhubung ke Host! Menunggu game dimulai...";
  });

  hostConn.on('data', data => handleClientData(data));
}

function updateLobbyUI() {
  const listEl = document.getElementById('player-list-lobby');
  listEl.innerHTML = `Pemain terkumpul (${players.length}/${targetCapacity}): <br>` + 
    players.map((p, i) => `<b>${i + 1}. ${p.name}</b>`).join('<br>');
}

function broadcast(data) {
  clientConns.forEach(c => { if (c.open) c.send(data); });
}

function log(msg) {
  const l = document.getElementById('log');
  l.innerHTML += `<div>> ${msg}</div>`;
  l.scrollTop = l.scrollHeight;
}

// ==========================================
// PEMBAGIAN KARTU & FASE PERMAINAN
// ==========================================

function createDeck() {
  let deck = [];
  for (let s of suits) {
    for (let r of Object.keys(rankValues)) {
      deck.push({
        suit: s, rank: r, numVal: rankValues[r], suitVal: suitValues[s], isRed: s === '♥' || s === '♦'
      });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function hostStartGame() {
  if (!isHost) return;
  if (players.length < 2) return alert("Minimal 2 pemain untuk mulai!");
  
  gameInProgress = true;
  startNewRound("Game Dimulai! Kumpulkan Kartu 3 milikmu ke meja.");
}

function startNewRound(bannerMsg = "") {
  let deck = createDeck();
  tableCardsPool = [];
  lastPlay = null;
  passCount = 0;
  selectedCardIndices = [];
  gamePhase = 'COLLECT_THREES';

  let cardCountPerPlayer = Math.floor(52 / players.length);
  players.forEach(p => {
    p.cards = [];
    p.hasSubmittedThrees = false;
    for (let i = 0; i < cardCountPerPlayer; i++) {
      p.cards.push(deck.pop());
    }
    sortCards(p.cards);
  });

  // Cek pemain yang tidak punya angka 3 sama sekali (otomatis selesai kumpul)
  players.forEach(p => {
    let has3 = p.cards.some(c => c.rank === '3');
    if (!has3) p.hasSubmittedThrees = true;
  });

  broadcastAndApplyState(bannerMsg || "Fase Kumpul Angka 3!");
}

function sortCards(cards) {
  cards.sort((a, b) => {
    if (a.numVal !== b.numVal) return a.numVal - b.numVal;
    return a.suitVal - b.suitVal;
  });
}

// ==========================================
// DATA HANDLERS
// ==========================================

function handleHostData(conn, data) {
  if (data.type === 'JOIN') {
    if (players.some(p => p.id === data.id)) return;
    players.push({ id: data.id, name: data.name, chips: 1000, cards: [], hasSubmittedThrees: false });
    updateLobbyUI();
    broadcast({ type: 'LOBBY_UPDATE', players: players });
  } 
  else if (data.type === 'SUBMIT_THREES') {
    processSubmitThrees(data.playerIndex, data.cardIndices);
  }
  else if (data.type === 'PLAY_CARDS') {
    processPlayCards(data.playerIndex, data.cards);
  } 
  else if (data.type === 'PASS') {
    processPass(data.playerIndex);
  }
}

function handleClientData(data) {
  if (data.type === 'LOBBY_UPDATE') {
    players = data.players;
    updateLobbyUI();
  } 
  else if (data.type === 'GAME_STATE') {
    applyGameState(data);
  } 
  else if (data.type === 'ERROR') {
    alert(data.message);
  }
}

// ==========================================
// LOGIKA KUMPUL ANGKA 3 & PERMAINAN
// ==========================================

function processSubmitThrees(pIdx, cardIndices) {
  let p = players[pIdx];
  let selected = cardIndices.map(i => p.cards[i]).filter(Boolean);

  // Validasi: Harus berupa kartu 3 saja
  if (selected.some(c => c.rank !== '3')) return;

  // Pindahkan ke meja dengan keterangan nama pemegang
  selected.forEach(c => {
    tableCardsPool.push({ card: c, owner: p.name });
  });

  // Hapus dari tangan
  p.cards = p.cards.filter(c => c.rank !== '3');
  p.hasSubmittedThrees = true;

  // Jika semua sudah kumpul angka 3, tentukan pemegang 3♠ untuk jalan pertama
  if (players.every(pl => pl.hasSubmittedThrees)) {
    gamePhase = 'PLAYING';
    
    // Cari pemegang 3♠
    let starterIndex = 0;
    tableCardsPool.forEach(item => {
      if (item.card.rank === '3' && item.card.suit === '♠') {
        let ownerIdx = players.findIndex(pl => pl.name === item.owner);
        if (ownerIdx !== -1) starterIndex = ownerIdx;
      }
    });

    activeTurnIndex = starterIndex;
    broadcastAndApplyState(`Semua Angka 3 terkumpul! ${players[starterIndex].name} (pemegang 3♠) jalan pertama.`);
  } else {
    broadcastAndApplyState(`${p.name} menaruh Angka 3 ke meja.`);
  }
}

function analyzeCombination(cards) {
  if (!cards || cards.length === 0) return null;
  let len = cards.length;
  let sorted = [...cards].sort((a, b) => a.numVal - b.numVal);

  if (len === 1) return { type: 'SINGLE', rank: sorted[0].numVal, suit: sorted[0].suitVal };
  if (len === 2 && sorted[0].numVal === sorted[1].numVal) return { type: 'PAIR', rank: sorted[1].numVal, suit: sorted[1].suitVal };

  let isSeq = true;
  for (let i = 0; i < len - 1; i++) {
    if (sorted[i + 1].numVal !== sorted[i].numVal + 1) { isSeq = false; break; }
  }

  if (len === 3 && isSeq) return { type: 'SERI_3', rank: sorted[2].numVal, suit: sorted[2].suitVal };
  if (len === 4 && isSeq) return { type: 'SERI_4', rank: sorted[3].numVal, suit: sorted[3].suitVal };
  if (len === 5 && isSeq) return { type: 'BOM_SERI_5', rank: sorted[4].numVal, suit: sorted[4].suitVal };
  if (len === 4 && sorted[0].numVal === sorted[3].numVal) return { type: 'BOM_FOUR_KIND', rank: sorted[0].numVal, suit: 3 };

  return null;
}

function isValidMove(selectedCards) {
  let combo = analyzeCombination(selectedCards);
  if (!combo) return { valid: false, reason: "Kombinasi kartu tidak sah!" };

  if (!lastPlay) return { valid: true, combo: combo };
  let last = lastPlay.combo;

  // Seri 3 atau 2 Single matikan As Single
  if (last.type === 'SINGLE' && last.rank === rankValues['A']) {
    if (combo.type === 'SERI_3') return { valid: true, combo: combo };
    if (combo.type === 'SINGLE' && combo.rank === rankValues['2']) return { valid: true, combo: combo };
  }

  // Seri 4 / BOM matikan Kartu 2
  if (last.type === 'SINGLE' && last.rank === rankValues['2']) {
    if (combo.type === 'SERI_4') return { valid: true, combo: combo };
    if (combo.type.startsWith('BOM_')) return { valid: true, combo: combo, isBOM: true };
  }

  // Mainkan kombinasi sejenis yang lebih tinggi
  if (combo.type === last.type && selectedCards.length === lastPlay.cards.length) {
    if (combo.rank > last.rank) return { valid: true, combo: combo };
    if (combo.rank === last.rank && combo.suit > last.suit) return { valid: true, combo: combo };
  }

  return { valid: false, reason: "Kartumu lebih kecil dari kartu meja!" };
}

function handlePlayCards() {
  let myIndex = players.findIndex(p => p.id === myId);
  if (myIndex === -1) myIndex = players.findIndex(p => p.name === myName);
  
  if (gamePhase === 'COLLECT_THREES') {
    let me = players[myIndex];
    let selected = selectedCardIndices.map(i => me.cards[i]);
    if (selected.length > 0 && selected.every(c => c.rank === '3')) {
      if (isHost) processSubmitThrees(myIndex, selectedCardIndices);
      else hostConn.send({ type: 'SUBMIT_THREES', playerIndex: myIndex, cardIndices: selectedCardIndices });
    } else {
      alert("Di fase ini, pilih hanya kartu Angka 3!");
    }
    return;
  }

  if (myIndex !== activeTurnIndex) return alert("Bukan giliranmu!");

  let me = players[myIndex];
  let selectedCards = selectedCardIndices.map(i => me.cards[i]);

  let check = isValidMove(selectedCards);
  if (!check.valid) return alert(check.reason);

  if (isHost) processPlayCards(myIndex, selectedCards);
  else hostConn.send({ type: 'PLAY_CARDS', playerIndex: myIndex, cards: selectedCards });
}

function handlePass() {
  let myIndex = players.findIndex(p => p.id === myId || p.name === myName);
  if (myIndex !== activeTurnIndex) return alert("Bukan giliranmu!");
  if (!lastPlay) return alert("Kamu penguasai meja, tidak bisa PASS!");

  if (isHost) processPass(myIndex);
  else hostConn.send({ type: 'PASS', playerIndex: myIndex });
}

function processPlayCards(pIdx, cardsPlayed) {
  let p = players[pIdx];
  let check = isValidMove(cardsPlayed);
  let combo = check.combo;

  cardsPlayed.forEach(cp => {
    let idx = p.cards.findIndex(c => c.rank === cp.rank && c.suit === cp.suit);
    if (idx !== -1) p.cards.splice(idx, 1);
  });

  tableCardsPool = cardsPlayed.map(c => ({ card: c, owner: p.name }));
  passCount = 0;

  // DETEKSI BOM ATAS KARTU 2
  if (lastPlay && lastPlay.combo.type === 'SINGLE' && lastPlay.combo.rank === rankValues['2']) {
    if (combo.type.startsWith('BOM_')) {
      let victim = players[lastPlay.playerIndex];
      let penalty = 150;
      victim.chips -= penalty;
      let survivors = players.filter(pl => pl.id !== victim.id);
      let share = Math.floor(penalty / survivors.length);
      survivors.forEach(s => s.chips += share);

      startNewRound(`💣 ${victim.name} terkena BOM dari ${p.name}! ${victim.name} KALAH. Taruhan terbagi.`);
      return;
    }
  }

  lastPlay = { playerIndex: pIdx, cards: cardsPlayed, combo: combo };

  if (p.cards.length === 0) {
    p.chips += 200;
    startNewRound(`🏆 HURA! ${p.name} MENANG ronde ini!`);
    return;
  }

  activeTurnIndex = (pIdx + 1) % players.length;
  broadcastAndApplyState(`${p.name} mengeluarkan kartu.`);
}

function processPass(pIdx) {
  passCount++;
  let p = players[pIdx];

  if (passCount >= players.length - 1) {
    activeTurnIndex = lastPlay.playerIndex;
    lastPlay = null;
    tableCardsPool = [];
    passCount = 0;
    broadcastAndApplyState(`${players[activeTurnIndex].name} menguasai meja (Bebas jalan baru)!`);
    return;
  }

  activeTurnIndex = (pIdx + 1) % players.length;
  broadcastAndApplyState(`${p.name} PASS.`);
}

function broadcastAndApplyState(msg = "") {
  let state = {
    type: 'GAME_STATE',
    players: players,
    activeTurnIndex: activeTurnIndex,
    tableCardsPool: tableCardsPool,
    lastPlay: lastPlay,
    gamePhase: gamePhase,
    bannerMsg: msg
  };
  broadcast(state);
  applyGameState(state);
}

// ==========================================
// RENDER UI DINAMIS
// ==========================================

function applyGameState(state) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game-container').style.display = 'flex';

  players = state.players;
  activeTurnIndex = state.activeTurnIndex;
  tableCardsPool = state.tableCardsPool;
  lastPlay = state.lastPlay;
  gamePhase = state.gamePhase;
  selectedCardIndices = [];

  if (state.bannerMsg) showBanner(state.bannerMsg);

  renderLayout();
}

function renderLayout() {
  let myIndex = players.findIndex(p => p.id === myId);
  if (myIndex === -1) myIndex = players.findIndex(p => p.name === myName);
  if (myIndex === -1) myIndex = 0;

  let me = players[myIndex];

  // Render Pemain Utama (Bawah)
  document.getElementById('name-my').innerText = me.name + " (Kamu)";
  document.getElementById('chips-my').innerText = me.chips;
  renderMyCards(me.cards);

  // Sembunyikan semua slot dulu
  ['top', 'left', 'right'].forEach(s => document.getElementById(`slot-${s}`).style.display = 'none');

  // Petakan posisi lawan secara relatif terhadap pemain lokal
  let otherPlayers = [];
  for (let i = 1; i < players.length; i++) {
    let idx = (myIndex + i) % players.length;
    otherPlayers.push({ player: players[idx], origIndex: idx });
  }

  if (players.length === 2) {
    setupSlot('top', otherPlayers[0]);
  } else if (players.length === 3) {
    setupSlot('left', otherPlayers[0]);
    setupSlot('right', otherPlayers[1]);
  } else if (players.length === 4) {
    setupSlot('left', otherPlayers[0]);
    setupSlot('top', otherPlayers[1]);
    setupSlot('right', otherPlayers[2]);
  }

  renderTablePool();

  // Pengaturan Tombol Kontrol
  let isMyTurn = (activeTurnIndex === myIndex);
  document.getElementById('info-my').classList.toggle('active', isMyTurn && gamePhase === 'PLAYING');

  const btnPlay = document.getElementById('btn-play');
  const btnPass = document.getElementById('btn-pass');

  if (gamePhase === 'COLLECT_THREES') {
    btnPlay.innerText = me.hasSubmittedThrees ? "Menunggu Pemain Lain..." : "Keluarkan Angka 3";
    btnPlay.disabled = me.hasSubmittedThrees;
    btnPass.disabled = true;
  } else {
    btnPlay.innerText = "Keluarkan Kartu Pilihan";
    btnPlay.disabled = !isMyTurn;
    btnPass.disabled = !isMyTurn || !lastPlay;
  }
}

function setupSlot(slotName, data) {
  if (!data) return;
  let p = data.player;
  let isTurn = (data.origIndex === activeTurnIndex) && (gamePhase === 'PLAYING');

  let slotEl = document.getElementById(`slot-${slotName}`);
  slotEl.style.display = 'flex';

  document.getElementById(`name-${slotName}`).innerText = p.name;
  document.getElementById(`chips-${slotName}`).innerText = p.chips;
  document.getElementById(`info-${slotName}`).classList.toggle('active', isTurn);

  let cardsHolder = document.getElementById(`cards-${slotName}`);
  cardsHolder.innerHTML = p.cards.map(() => `<div class="card back"></div>`).join('');
}

function renderMyCards(cards) {
  const container = document.getElementById('cards-my');
  container.innerHTML = cards.map((c, idx) => {
    let isSelected = selectedCardIndices.includes(idx);
    return `
      <div class="card ${c.isRed ? 'red' : ''} ${isSelected ? 'selected' : ''}" onclick="toggleSelectCard(${idx})">
        <div>${c.rank}</div>
        <div class="suit">${c.suit}</div>
        <div style="align-self:flex-end;">${c.rank}</div>
      </div>
    `;
  }).join('');
}

function toggleSelectCard(index) {
  let pos = selectedCardIndices.indexOf(index);
  if (pos === -1) selectedCardIndices.push(index);
  else selectedCardIndices.splice(pos, 1);
  
  let myIndex = players.findIndex(p => p.id === myId || p.name === myName);
  if (myIndex !== -1) renderMyCards(players[myIndex].cards);
}

function renderTablePool() {
  const poolEl = document.getElementById('table-cards-pool');
  if (tableCardsPool.length === 0) {
    poolEl.innerHTML = `<span style="font-size:11px; color:#aaa; align-self:center;">Meja Kosong</span>`;
    return;
  }
  poolEl.innerHTML = tableCardsPool.map(item => {
    let c = item.card;
    return `
      <div style="display:flex; flex-direction:column; align-items:center;">
        <div class="card ${c.isRed ? 'red' : ''}">
          <div>${c.rank}</div>
          <div class="suit">${c.suit}</div>
          <div style="align-self:flex-end;">${c.rank}</div>
        </div>
        <span style="font-size:9px; color:#f1c40f; margin-top:2px;">${item.owner}</span>
      </div>
    `;
  }).join('');
}

function showBanner(msg) {
  const b = document.getElementById('game-banner');
  b.innerText = msg;
  b.style.display = 'block';
  setTimeout(() => { b.style.display = 'none'; }, 4000);
}
