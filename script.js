// ==========================================
// CAPSA BANTING MULTIPLAYER (PeerJS WebRTC)
// ==========================================

let peer = null;
let hostConn = null;
let clientConns = []; // Untuk Host menyimpan semua koneksi client
let isHost = false;
let myName = "";
let myId = "";
let targetCapacity = 4;

// Game State Data
let players = []; // { id, name, chips, cards: [], folded: false }
let activeTurnIndex = 0;
let lastPlay = null; // { playerIndex, cards: [], type, rank }
let passCount = 0;
let tableCardsPool = [];
let selectedCardIndices = [];
let gameInProgress = false;

// Hirarki Kartu & Suit
const suits = ['♣', '♦', '♥', '♠']; // Suit value: ♣(0), ♦(1), ♥(2), ♠(3)
const suitValues = { '♣': 0, '♦': 1, '♥': 2, '♠': 3 };
const rankValues = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
};

// ==========================================
// 1. KONEKSI NETWORK & LOBBY
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  peer = new Peer();

  peer.on('open', id => {
    myId = id;
    document.getElementById('status').innerText = "Siap! Kode Ruangan Kamu: " + id;
  });

  peer.on('connection', conn => {
    if (!isHost) return;
    if (clientConns.length >= targetCapacity - 1 || gameInProgress) {
      conn.send({ type: 'ERROR', message: 'Ruangan penuh atau permainan sudah dimulai.' });
      setTimeout(() => conn.close(), 500);
      return;
    }

    clientConns.push(conn);

    conn.on('data', data => handleHostData(conn, data));
    conn.on('close', () => handleDisconnect(conn));
  });
});

function createRoom() {
  if (!myId) return alert("Jaringan belum siap, tunggu sebentar...");
  isHost = true;
  myName = document.getElementById('username').value.trim() || "Host";
  targetCapacity = parseInt(document.getElementById('player-capacity').value);

  players = [{
    id: myId,
    name: myName,
    chips: 1000,
    cards: [],
    folded: false
  }];

  navigator.clipboard.writeText(myId);
  document.getElementById('status').innerText = `Ruangan (${targetCapacity} Pemain) dibuat! Kode ID tersalin. Menunggu pemain lain...`;
  
  updateLobbyUI();
  document.getElementById('btn-host-start').style.display = 'block';
}

function joinRoom() {
  const targetId = document.getElementById('join-id').value.trim();
  if (!targetId) return alert("Masukkan Kode Ruangan Host!");
  
  isHost = false;
  myName = document.getElementById('username').value.trim() || "Pemain";

  hostConn = peer.connect(targetId);

  hostConn.on('open', () => {
    hostConn.send({ type: 'JOIN', name: myName, id: myId });
    document.getElementById('status').innerText = "Terhubung ke Host! Menunggu ruangan siap...";
  });

  hostConn.on('data', data => handleClientData(data));
}

function updateLobbyUI() {
  const listEl = document.getElementById('player-list-lobby');
  listEl.innerHTML = `Pemain terkumpul (${players.length}/${targetCapacity}): <br>` + 
    players.map((p, i) => `<b>${i + 1}. ${p.name}</b>`).join('<br>');
}

function broadcast(data) {
  clientConns.forEach(c => {
    if (c.open) c.send(data);
  });
}

function log(msg) {
  const l = document.getElementById('log');
  l.innerHTML += `<div>> ${msg}</div>`;
  l.scrollTop = l.scrollHeight;
}

// ==========================================
// 2. PEMBAGIAN KARTU & KUMPUL ANGKA 3
// ==========================================

function createDeck() {
  let deck = [];
  for (let s of suits) {
    for (let r of Object.keys(rankValues)) {
      deck.push({
        suit: s,
        rank: r,
        numVal: rankValues[r],
        suitVal: suitValues[s],
        isRed: s === '♥' || s === '♦'
      });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function hostStartGame() {
  if (!isHost) return;
  if (players.length < 2) return alert("Minimal harus ada 2 pemain untuk memulai!");
  
  gameInProgress = true;
  startNewRound("Permainan Dimulai!");
}

function startNewRound(bannerMsg = "") {
  let deck = createDeck();
  tableCardsPool = [];
  lastPlay = null;
  passCount = 0;
  selectedCardIndices = [];

  // Reset status pemain
  players.forEach(p => {
    p.cards = [];
    p.folded = false;
  });

  // Pembagian Kartu Habis Sesuai Jumlah Pemain
  let cardCountPerPlayer = Math.floor(52 / players.length);
  players.forEach(p => {
    for (let i = 0; i < cardCountPerPlayer; i++) {
      p.cards.push(deck.pop());
    }
    sortCards(p.cards);
  });

  // Kumpul Angka 3 Otomatis
  let starterIndex = 0;
  let hasThreeOfSpades = false;

  players.forEach((p, pIdx) => {
    let threes = p.cards.filter(c => c.rank === '3');
    threes.forEach(c => {
      tableCardsPool.push({ card: c, owner: p.name });
      if (c.suit === '♠') {
        starterIndex = pIdx;
        hasThreeOfSpades = true;
      }
    });
    // Hapus kartu 3 dari tangan pemain
    p.cards = p.cards.filter(c => c.rank !== '3');
  });

  // Jika tidak ada 3♠ (jarang terjadi), tentukan acak atau pemain 0
  activeTurnIndex = starterIndex;

  // Broadcast data state ke semua client
  let state = {
    type: 'GAME_STATE',
    players: players,
    activeTurnIndex: activeTurnIndex,
    tableCardsPool: tableCardsPool,
    lastPlay: lastPlay,
    bannerMsg: bannerMsg || `Angka 3 dikumpulkan! ${players[starterIndex].name} (pemegang 3♠) jalan pertama.`
  };

  broadcast(state);
  applyGameState(state);
}

function sortCards(cards) {
  cards.sort((a, b) => {
    if (a.numVal !== b.numVal) return a.numVal - b.numVal;
    return a.suitVal - b.suitVal;
  });
}

// ==========================================
// 3. HANDLER KONEKSI & RECEIVE DATA
// ==========================================

function handleHostData(conn, data) {
  if (data.type === 'JOIN') {
    players.push({
      id: data.id,
      name: data.name,
      chips: 1000,
      cards: [],
      folded: false
    });
    updateLobbyUI();
    broadcast({ type: 'LOBBY_UPDATE', players: players });
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

function handleDisconnect(conn) {
  log("Seorang pemain terputus dari jaringan.");
}

// ==========================================
// 4. VALIDASI KOMBINASI & ATURAN CAPSA
// ==========================================

function analyzeCombination(cards) {
  if (!cards || cards.length === 0) return null;
  let len = cards.length;
  let sorted = [...cards].sort((a, b) => a.numVal - b.numVal);

  // Single
  if (len === 1) {
    return { type: 'SINGLE', rank: sorted[0].numVal, suit: sorted[0].suitVal, topCard: sorted[0] };
  }

  // Pair
  if (len === 2 && sorted[0].numVal === sorted[1].numVal) {
    return { type: 'PAIR', rank: sorted[1].numVal, suit: sorted[1].suitVal, topCard: sorted[1] };
  }

  // Check Seri (Straight Sequential)
  let isSequence = true;
  for (let i = 0; i < len - 1; i++) {
    if (sorted[i + 1].numVal !== sorted[i].numVal + 1) {
      isSequence = false;
      break;
    }
  }

  // Seri 3 (5-6-7) -> Penghenti As
  if (len === 3 && isSequence) {
    return { type: 'SERI_3', rank: sorted[2].numVal, topCard: sorted[2] };
  }

  // Seri 4 (4-5-6-7) -> Pemati Kartu 2
  if (len === 4 && isSequence) {
    return { type: 'SERI_4', rank: sorted[3].numVal, topCard: sorted[3] };
  }

  // Seri 5 (5-6-7-8-9) -> Kategori BOM
  if (len === 5 && isSequence) {
    return { type: 'BOM_SERI_5', rank: sorted[4].numVal, topCard: sorted[4] };
  }

  // 4 Kembar / Four of a Kind (5-5-5-5) -> Kategori BOM
  if (len === 4 && sorted[0].numVal === sorted[3].numVal) {
    return { type: 'BOM_FOUR_KIND', rank: sorted[0].numVal, topCard: sorted[3] };
  }

  return null; // Kombinasi tidak valid
}

function isValidMove(selectedCards) {
  let combo = analyzeCombination(selectedCards);
  if (!combo) return { valid: false, reason: "Kombinasi kartu tidak valid!" };

  // Jika meja kosong / bebas buka jalan
  if (!lastPlay) return { valid: true, combo: combo };

  let last = lastPlay.combo;

  // --- ATURAN KHUSUS KHAS CAPSA BANTING ---

  // 1. Seri 3 & Kartu 2 Single mematikan As Single
  if (last.type === 'SINGLE' && last.rank === rankValues['A']) {
    if (combo.type === 'SERI_3') return { valid: true, combo: combo };
    if (combo.type === 'SINGLE' && combo.rank === rankValues['2']) return { valid: true, combo: combo };
  }

  // 2. Mematikan / Menge-BOM Kartu 2 Single
  if (last.type === 'SINGLE' && last.rank === rankValues['2']) {
    if (combo.type === 'SERI_4') return { valid: true, combo: combo };
    if (combo.type === 'BOM_SERI_5' || combo.type === 'BOM_FOUR_KIND') {
      return { valid: true, combo: combo, isBOM: true };
    }
  }

  // 3. Menimpa BOM lawan dengan BOM lebih tinggi
  if (last.type.startsWith('BOM_') && combo.type.startsWith('BOM_')) {
    if (combo.type === 'BOM_FOUR_KIND' && last.type === 'BOM_SERI_5') return { valid: true, combo: combo };
    if (combo.type === last.type && combo.rank > last.rank) return { valid: true, combo: combo };
  }

  // 4. Aturan Normal: Jenis kombinasi harus sama & jumlah kartu sama
  if (combo.type === last.type && selectedCards.length === lastPlay.cards.length) {
    if (combo.rank > last.rank) return { valid: true, combo: combo };
    if (combo.rank === last.rank && combo.suit > last.suit) return { valid: true, combo: combo };
  }

  return { valid: false, reason: "Kartu kamu kurang tinggi untuk memukul meja!" };
}

// ==========================================
// 5. EKSEKUSI AKSI & SISTEM BOM
// ==========================================

function handlePlayCards() {
  let myIndex = players.findIndex(p => p.id === myId || p.name === myName);
  if (myIndex !== activeTurnIndex) return alert("Bukan giliranmu!");

  let me = players[myIndex];
  let selectedCards = selectedCardIndices.map(i => me.cards[i]);

  let check = isValidMove(selectedCards);
  if (!check.valid) return alert(check.reason);

  if (isHost) {
    processPlayCards(myIndex, selectedCards);
  } else {
    hostConn.send({ type: 'PLAY_CARDS', playerIndex: myIndex, cards: selectedCards });
  }
}

function handlePass() {
  let myIndex = players.findIndex(p => p.id === myId || p.name === myName);
  if (myIndex !== activeTurnIndex) return alert("Bukan giliranmu!");
  if (!lastPlay) return alert("Kamu menguasai meja, tidak bisa PASS!");

  if (isHost) {
    processPass(myIndex);
  } else {
    hostConn.send({ type: 'PASS', playerIndex: myIndex });
  }
}

function processPlayCards(pIdx, cardsPlayed) {
  let p = players[pIdx];
  let check = isValidMove(cardsPlayed);
  let combo = check.combo;

  // Hapus kartu dari tangan pemain
  cardsPlayed.forEach(cp => {
    let idx = p.cards.findIndex(c => c.rank === cp.rank && c.suit === cp.suit);
    if (idx !== -1) p.cards.splice(idx, 1);
  });

  tableCardsPool = cardsPlayed.map(c => ({ card: c, owner: p.name }));
  passCount = 0;

  // CEK SKENARIO TERJADI BOM ATAS KARTU 2
  if (lastPlay && lastPlay.combo.type === 'SINGLE' && lastPlay.combo.rank === rankValues['2']) {
    if (combo.type === 'BOM_SERI_5' || combo.type === 'BOM_FOUR_KIND') {
      let victimIdx = lastPlay.playerIndex;
      let victim = players[victimIdx];

      log(`💣 KABOOM! ${p.name} MENGE-BOM KARTU 2 MILIK ${victim.name}!`);

      // Penalti Chip Korban BOM
      let penalty = 100;
      victim.chips -= penalty;

      let survivors = players.filter((_, idx) => idx !== victimIdx);
      let share = Math.floor(penalty / survivors.length);
      survivors.forEach(s => s.chips += share);

      let msg = `💣 ${victim.name} kena BOM oleh ${p.name}! ${victim.name} KALAH. Taruhan $${penalty} dibagikan. Ronde diulang!`;
      startNewRound(msg);
      return;
    }
  }

  lastPlay = { playerIndex: pIdx, cards: cardsPlayed, combo: combo };

  // CEK PEMENANG (Kartu habis)
  if (p.cards.length === 0) {
    let msg = `🏆 HURA! ${p.name} BERHASIL MENGHABISKAN KARTU DAN MENJADI PEMENANG!`;
    p.chips += 200; // Bonus Kemenangan
    startNewRound(msg);
    return;
  }

  // Lanjut Giliran Pemain Berikutnya
  activeTurnIndex = getNextActivePlayerIndex(pIdx);

  broadcastAndApplyState(`${p.name} mengeluarkan ${cardsPlayed.length} kartu.`);
}

function processPass(pIdx) {
  passCount++;
  let p = players[pIdx];
  log(`${p.name} memilih PASS.`);

  // Jika semua lawan PASS, pemain terakhir yang menaruh kartu menguasai meja
  let activePlayersCount = players.filter(pl => !pl.folded).length;
  if (passCount >= activePlayersCount - 1) {
    activeTurnIndex = lastPlay.playerIndex;
    lastPlay = null;
    tableCardsPool = [];
    passCount = 0;
    broadcastAndApplyState(`${players[activeTurnIndex].name} menguasai meja (Bebas buka kartu baru)!`);
    return;
  }

  activeTurnIndex = getNextActivePlayerIndex(pIdx);
  broadcastAndApplyState(`${p.name} PASS.`);
}

function getNextActivePlayerIndex(currentIdx) {
  let next = (currentIdx + 1) % players.length;
  while (players[next].folded) {
    next = (next + 1) % players.length;
  }
  return next;
}

function broadcastAndApplyState(msg = "") {
  let state = {
    type: 'GAME_STATE',
    players: players,
    activeTurnIndex: activeTurnIndex,
    tableCardsPool: tableCardsPool,
    lastPlay: lastPlay,
    bannerMsg: msg
  };
  broadcast(state);
  applyGameState(state);
}

// ==========================================
// 6. RENDER TAMPILAN UI DINAMIS
// ==========================================

function applyGameState(state) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game-container').style.display = 'flex';

  players = state.players;
  activeTurnIndex = state.activeTurnIndex;
  tableCardsPool = state.tableCardsPool;
  lastPlay = state.lastPlay;
  selectedCardIndices = [];

  if (state.bannerMsg) showBanner(state.bannerMsg);

  renderLayout();
}

function renderLayout() {
  let myIndex = players.findIndex(p => p.id === myId || p.name === myName);
  if (myIndex === -1) myIndex = 0;

  let me = players[myIndex];

  // Render Pemain Utama (Bawah)
  document.getElementById('name-my').innerText = me.name;
  document.getElementById('chips-my').innerText = me.chips;
  renderMyCards(me.cards);

  // Dynamic Position Mapping (Top, Left, Right)
  const slots = ['top', 'left', 'right'];
  slots.forEach(s => document.getElementById(`slot-${s}`).style.display = 'none');

  let otherPlayers = [];
  for (let i = 1; i < players.length; i++) {
    let idx = (myIndex + i) % players.length;
    otherPlayers.push({ player: players[idx], origIndex: idx });
  }

  if (players.length === 2) {
    // 2 Pemain -> Lawan di Atas
    setupSlot('top', otherPlayers[0]);
  } else if (players.length === 3) {
    // 3 Pemain -> Kiri & Kanan
    setupSlot('left', otherPlayers[0]);
    setupSlot('right', otherPlayers[1]);
  } else if (players.length === 4) {
    // 4 Pemain -> Left, Top, Right
    setupSlot('left', otherPlayers[0]);
    setupSlot('top', otherPlayers[1]);
    setupSlot('right', otherPlayers[2]);
  }

  // Render Kartu di Tengah Meja
  renderTablePool();

  // Highlight Giliran & Control Buttons
  let isMyTurn = (activeTurnIndex === myIndex);
  document.getElementById('info-my').classList.toggle('active', isMyTurn);

  document.getElementById('btn-play').disabled = !isMyTurn;
  document.getElementById('btn-pass').disabled = !isMyTurn || !lastPlay;
}

function setupSlot(slotName, data) {
  if (!data) return;
  let p = data.player;
  let isTurn = (data.origIndex === activeTurnIndex);

  let slotEl = document.getElementById(`slot-${slotName}`);
  slotEl.style.display = 'flex';

  document.getElementById(`name-${slotName}`).innerText = p.name;
  document.getElementById(`chips-${slotName}`).innerText = p.chips;
  document.getElementById(`info-${slotName}`).classList.toggle('active', isTurn);

  // Render Kartu Tertutup Lawan
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
  if (pos === -1) {
    selectedCardIndices.push(index);
  } else {
    selectedCardIndices.splice(pos, 1);
  }
  let myIndex = players.findIndex(p => p.id === myId || p.name === myName);
  renderMyCards(players[myIndex].cards);
}

function renderTablePool() {
  const poolEl = document.getElementById('table-cards-pool');
  if (tableCardsPool.length === 0) {
    poolEl.innerHTML = `<span style="font-size:11px; color:#666; align-self:center;">Meja Kosong</span>`;
    return;
  }
  poolEl.innerHTML = tableCardsPool.map(item => {
    let c = item.card;
    return `
      <div class="card ${c.isRed ? 'red' : ''}">
        <div>${c.rank}</div>
        <div class="suit">${c.suit}</div>
        <div style="align-self:flex-end;">${c.rank}</div>
      </div>
    `;
  }).join('');
}

function showBanner(msg) {
  const b = document.getElementById('game-banner');
  b.innerText = msg;
  b.style.display = 'block';
  setTimeout(() => {
    b.style.display = 'none';
  }, 4000);
}