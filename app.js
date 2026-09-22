const { createClient } = window.supabase;
const cfg = window.APP_CONFIG || {};

const supabase = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY
);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let user = null;
let profile = null;
let currentLobby = null;
let lobbyPlayers = [];
let lobbyChannel = null;
let game = null;
let myBet = 0;

const suits = ["♠", "♥", "♦", "♣"];
const ranks = [
  "A", "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "J", "Q", "K"
];

/* =========================
   BASIC HELPERS
========================= */

function toast(message) {
  const el = $("#toast");

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.remove("show");
  }, 2400);
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]
  );
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

function makeShoe(decks = 6) {
  const shoe = [];

  for (let d = 0; d < decks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        shoe.push({ rank, suit });
      }
    }
  }

  return shuffle(shoe);
}

function handValue(cards = []) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.rank === "A") {
      total += 11;
      aces++;
    } else if (
      card.rank === "K" ||
      card.rank === "Q" ||
      card.rank === "J"
    ) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return {
    total,
    soft: aces > 0
  };
}

function isBlackjack(cards = []) {
  return cards.length === 2 && handValue(cards).total === 21;
}

function currentGame() {
  return JSON.parse(JSON.stringify(game || {}));
}

function nameOf(userId) {
  return (
    lobbyPlayers.find(p => p.user_id === userId)
      ?.profiles
      ?.display_name || "player"
  );
}

/* =========================
   PROFILE
========================= */

async function getProfile() {
  if (!user?.id) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    toast(error.message);
    return false;
  }

  profile = data;

  renderBalance();

  return true;
}

function renderBalance() {
  const balance = Number(profile?.balance || 0);

  if ($("#topBalance")) {
    $("#topBalance").textContent =
      balance.toLocaleString();
  }

  if ($("#profileBalance")) {
    $("#profileBalance").textContent =
      balance.toLocaleString();
  }

  if ($("#profileName")) {
    $("#profileName").textContent =
      profile?.display_name || "Player";
  }

  if ($("#profileEmail")) {
    $("#profileEmail").textContent =
      profile?.email || user?.email || "";
  }
}

/* =========================
   VIEW SWITCHING
========================= */

function show(view) {
  $("#homeView")?.classList.toggle(
    "hidden",
    view !== "home"
  );

  $("#lobbyView")?.classList.toggle(
    "hidden",
    view !== "lobby"
  );
}

/* =========================
   LOBBIES
========================= */

async function loadLobbies() {
  const { data, error } = await supabase
    .from("lobbies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    toast(error.message);
    return;
  }

  renderLobbies(data || []);
}

function renderLobbies(rows) {
  const list = $("#lobbyList");
  const empty = $("#emptyLobbies");

  if (!list || !empty) return;

  if (!rows.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  list.innerHTML = rows.map(lobby => `
    <div class="lobby-card">
      <div class="eyebrow">OPEN TABLE</div>

      <h4>${esc(lobby.name)}</h4>

      <div class="lobby-meta">
        <span>♟ Private</span>
        <span>🪙 ${Number(
          lobby.starting_chips || 5000
        ).toLocaleString()}</span>
        <span>${esc(lobby.status || "waiting")}</span>
      </div>

      <button
        type="button"
        class="secondary join-btn"
        data-id="${lobby.id}"
      >
        Join table
      </button>
    </div>
  `).join("");

  $$(".join-btn").forEach(button => {
    button.addEventListener("click", () => {
      joinLobby(button.dataset.id);
    });
  });
}

async function createLobby() {
  if (!user) {
    toast("You are not logged in.");
    return;
  }

  const name =
    $("#newLobbyName")?.value.trim() ||
    "Friends Table";

  const starting =
    Number($("#newStartingChips")?.value) || 5000;

  const code = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();

  const initialGame = {
    phase: "waiting",
    shoe: [],
    dealer: [],
    hands: {},
    bets: {},
    bankrolls: {
      [user.id]: starting
    },
    done: {},
    results: {},
    ledger: {},
    turn_user_id: null,
    message: ""
  };

  const { data, error } = await supabase
    .from("lobbies")
    .insert({
      name,
      invite_code: code,
      host_id: user.id,
      starting_chips: starting,
      game: initialGame,
      status: "waiting"
    })
    .select()
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  const { error: playerError } = await supabase
    .from("lobby_players")
    .insert({
      lobby_id: data.id,
      user_id: user.id,
      seat: 1
    });

  if (playerError) {
    toast(playerError.message);
    return;
  }

  $("#createModal")?.classList.add("hidden");

  await joinLobby(data.id);
}

async function joinLobby(id) {
  const { data: lobby, error } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  const {
    data: players,
    error: playerError
  } = await supabase
    .from("lobby_players")
    .select("*, profiles(display_name,balance,email)")
    .eq("lobby_id", id)
    .order("seat");

  if (playerError) {
    toast(playerError.message);
    return;
  }

  const alreadyJoined = players.some(
    player => player.user_id === user.id
  );

  if (!alreadyJoined) {
    const usedSeats = new Set(
      players.map(player => player.seat)
    );

    let seat = 1;

    while (usedSeats.has(seat)) {
      seat++;
    }

    if (seat > 7) {
      toast("This table is full.");
      return;
    }

    const { error: joinError } = await supabase
      .from("lobby_players")
      .insert({
        lobby_id: id,
        user_id: user.id,
        seat
      });

    if (joinError) {
      toast(joinError.message);
      return;
    }
  }

  currentLobby = lobby;

  game = lobby.game || {
    phase: "waiting",
    shoe: [],
    dealer: [],
    hands: {},
    bets: {},
    bankrolls: {},
    done: {},
    results: {},
    ledger: {},
    turn_user_id: null,
    message: ""
  };

  if (!game.bankrolls) {
    game.bankrolls = {};
  }

  if (!game.bankrolls[user.id]) {
    game.bankrolls[user.id] =
      Number(lobby.starting_chips || 5000);
  }

  await refreshLobby();

  subscribeLobby();

  show("lobby");
}

/* =========================
   LOBBY REFRESH / REALTIME
========================= */

async function refreshLobby() {
  if (!currentLobby) return;

  const { data: lobby } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", currentLobby.id)
    .single();

  if (lobby) {
    currentLobby = lobby;

    game = lobby.game || {
      phase: "waiting",
      shoe: [],
      dealer: [],
      hands: {},
      bets: {},
      bankrolls: {},
      done: {},
      results: {},
      ledger: {},
      turn_user_id: null,
      message: ""
    };
  }

  if (!game.bankrolls) {
    game.bankrolls = {};
  }

  const {
    data: players,
    error
  } = await supabase
    .from("lobby_players")
    .select("*, profiles(display_name,balance,email)")
    .eq("lobby_id", currentLobby.id)
    .order("seat");

  if (error) {
    toast(error.message);
    return;
  }

  lobbyPlayers = players || [];

  const starting =
    Number(currentLobby.starting_chips || 5000);

  for (const player of lobbyPlayers) {
    if (
      game.bankrolls[player.user_id] === undefined
    ) {
      game.bankrolls[player.user_id] = starting;
    }
  }

  $("#lobbyTitle").textContent =
    currentLobby.name;

  $("#copyCodeBtn").textContent =
    currentLobby.invite_code;

  $("#playerCount").textContent =
    `${lobbyPlayers.length} / 7`;

  const host = lobbyPlayers.find(
    p => p.user_id === currentLobby.host_id
  );

  $("#hostLabel").textContent =
    `Host: ${host?.profiles?.display_name || "—"}`;

  myBet =
    Number(game?.bets?.[user.id] || 0);

  $("#currentBet").textContent =
    myBet.toLocaleString();

  renderTable();

  await loadChat();
}

function subscribeLobby() {
  if (lobbyChannel) {
    supabase.removeChannel(lobbyChannel);
  }

  lobbyChannel = supabase
    .channel(`lobby-${currentLobby.id}`)

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobbies",
        filter: `id=eq.${currentLobby.id}`
      },
      refreshLobby
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_players",
        filter: `lobby_id=eq.${currentLobby.id}`
      },
      refreshLobby
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter: `lobby_id=eq.${currentLobby.id}`
      },
      loadChat
    )

    .subscribe();
}

/* =========================
   CHAT
========================= */

async function loadChat() {
  if (!currentLobby) return;

  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("lobby_id", currentLobby.id)
    .order("created_at", {
      ascending: true
    })
    .limit(80);

  if (error) {
    return;
  }

  $("#chatLog").innerHTML =
    (data || [])
      .map(message => `
        <div class="chat-msg">
          <strong>
            ${esc(message.display_name)}
          </strong>
          ${esc(message.message)}
        </div>
      `)
      .join("");

  const chat = $("#chatLog");

  if (chat) {
    chat.scrollTop = chat.scrollHeight;
  }
}

/* =========================
   CARDS
========================= */

function cardHtml(card, back = false) {
  if (back) {
    return `<div class="card back">?</div>`;
  }

  const red =
    card.suit === "♥" ||
    card.suit === "♦";

  return `
    <div class="card ${red ? "red" : ""}">
      <span>${card.rank}</span>
      <span class="suit">${card.suit}</span>
      <span>${card.rank}</span>
    </div>
  `;
}

/* =========================
   TABLE RENDERING
========================= */

function renderTable() {
  if (!currentLobby || !game) return;

  const dealer =
    game.dealer || [];

  const hideHole =
    game.phase === "playing" &&
    dealer.length > 1;

  $("#dealerCards").innerHTML =
    dealer
      .map((card, index) =>
        cardHtml(
          card,
          hideHole && index === 1
        )
      )
      .join("");

  const dealerValue =
    !hideHole && dealer.length
      ? handValue(dealer).total
      : "";

  $("#dealerMeta").textContent =
    hideHole
      ? "Hole card hidden"
      : dealer.length
        ? `Total ${dealerValue}`
        : "";

  const phase =
    game.phase || "waiting";

  let status = "";

  if (phase === "waiting") {
    status =
      "Set your bets, then the host deals.";
  } else if (phase === "playing") {
    if (game.turn_user_id === user.id) {
      status = "Your turn.";
    } else {
      status =
        `Waiting for ${nameOf(game.turn_user_id)}…`;
    }
  } else if (phase === "dealer") {
    status =
      "Dealer is resolving the hand…";
  } else if (phase === "finished") {
    status =
      game.message || "Round finished.";
  }

  $("#tableStatus").textContent = status;

  $("#playersZone").innerHTML =
    lobbyPlayers.map(player => {
      const hand =
        game.hands?.[player.user_id] || [];

      const value =
        handValue(hand);

      const isMe =
        player.user_id === user.id;

      const bet =
        Number(game.bets?.[player.user_id] || 0);

      const bankroll =
        Number(game.bankrolls?.[player.user_id] || 0);

      const result =
        game.results?.[player.user_id];

      return `
        <div class="seat ${isMe ? "me" : ""}">

          <div class="seat-name">
            ${esc(
              player.profiles?.display_name ||
              "Player"
            )}
          </div>

          ${
            player.user_id === currentLobby.host_id
              ? `<div class="seat-host">HOST</div>`
              : ""
          }

          <div class="seat-bet">
            <span class="status-dot"></span>
            Bet ${bet.toLocaleString()}
          </div>

          <div class="cards">
            ${hand
              .map(card => cardHtml(card))
              .join("")}
          </div>

          ${
            hand.length
              ? `
                <div class="hand-meta">
                  ${value.total}
                  ${value.soft ? " soft" : ""}
                </div>
              `
              : ""
          }

          <div class="seat-ledger">
            🪙 ${bankroll.toLocaleString()}
          </div>

          ${
            result
              ? `
                <div class="seat-result">
                  ${esc(result)}
                </div>
              `
              : ""
          }

        </div>
      `;
    })
    .join("");

  const myHand =
    game.hands?.[user.id] || [];

  const myTurn =
    game.phase === "playing" &&
    game.turn_user_id === user.id;

  $("#playerActions")
    .classList
    .toggle("hidden", !myTurn);

  $("#dealerActionBtn")
    .classList
    .toggle(
      "hidden",
      !(
        game.phase === "dealer" &&
        currentLobby.host_id === user.id
      )
    );

  $("#startRoundBtn")
    .classList
    .toggle(
      "hidden",
      !(
        game.phase === "waiting" &&
        currentLobby.host_id === user.id
      )
    );

  $("#startRoundBtn").textContent =
    game.phase === "waiting"
      ? "Deal round"
      : "Start round";

  $("#doubleBtn").disabled =
    !(
      myTurn &&
      myHand.length === 2 &&
      Number(game.bankrolls?.[user.id] || 0) >= myBet
    );

  renderDealerBank();
}

/* =========================
   BETTING
========================= */

async function setBet(amount) {
  amount = Math.floor(Number(amount));

  if (
    !Number.isFinite(amount) ||
    amount < 5 ||
    amount % 5 !== 0
  ) {
    toast(
      "Bet must be a multiple of 5."
    );
    return;
  }

  if (!currentLobby || !game) return;

  if (game.phase !== "waiting") {
    toast(
      "Bets can only be changed before a deal."
    );
    return;
  }

  const bankroll =
    Number(game.bankrolls?.[user.id] || 0);

  if (amount > bankroll) {
    toast(
      "Not enough virtual chips."
    );
    return;
  }

  const g = currentGame();

  g.bets = {
    ...(g.bets || {}),
    [user.id]: amount
  };

  myBet = amount;

  await saveGame(g);
}

/* =========================
   START ROUND
========================= */

async function startRound() {
  if (!currentLobby) return;

  if (currentLobby.host_id !== user.id) {
    toast(
      "Only the host can deal."
    );
    return;
  }

  const active =
    lobbyPlayers.filter(
      player =>
        Number(
          game?.bets?.[player.user_id] || 0
        ) > 0
    );

  if (!active.length) {
    toast(
      "At least one player needs a bet."
    );
    return;
  }

  const shoe = makeShoe(6);
  const hands = {};

  const bets = {
    ...(game?.bets || {})
  };

  const bankrolls = {
    ...(game?.bankrolls || {})
  };

  const done = {};

  for (const player of active) {
    const bet =
      Number(bets[player.user_id] || 0);

    if (
      bet <= 0 ||
      bankrolls[player.user_id] < bet
    ) {
      continue;
    }

    hands[player.user_id] = [
      shoe.pop(),
      shoe.pop()
    ];

    bankrolls[player.user_id] -= bet;

    done[player.user_id] =
      isBlackjack(hands[player.user_id]);
  }

  const dealer = [
    shoe.pop(),
    shoe.pop()
  ];

  const playingPlayers =
    active.filter(
      player =>
        hands[player.user_id]
    );

  let firstTurn =
    playingPlayers.find(
      player => !done[player.user_id]
    )?.user_id || null;

  const newGame = {
    phase: firstTurn
      ? "playing"
      : "dealer",

    shoe,
    dealer,
    hands,
    bets,
    bankrolls,
    done,
    results: {},
    ledger: {
      ...(game?.ledger || {})
    },
    turn_user_id: firstTurn,
    message: ""
  };

  game = newGame;

  await saveGame(newGame);

  if (!firstTurn) {
    await runDealer();
  }
}

/* =========================
   PLAYER ACTIONS
========================= */

async function playerAction(type) {
  if (
    !game ||
    game.phase !== "playing" ||
    game.turn_user_id !== user.id
  ) {
    return;
  }

  const g = currentGame();

  const hand =
    g.hands[user.id] || [];

  const bet =
    Number(g.bets[user.id] || 0);

  if (!bet) return;

  if (type === "hit") {
    const card = g.shoe.pop();

    g.hands[user.id] = [
      ...hand,
      card
    ];

    const value =
      handValue(g.hands[user.id]).total;

    if (value >= 21) {
      g.done[user.id] = true;

      g.turn_user_id =
        nextTurn(g, user.id);
    }
  }

  if (type === "stand") {
    g.done[user.id] = true;

    g.turn_user_id =
      nextTurn(g, user.id);
  }

  if (type === "double") {
    const bankroll =
      Number(g.bankrolls[user.id] || 0);

    if (
      hand.length !== 2 ||
      bankroll < bet
    ) {
      toast(
        "Double unavailable."
      );
      return;
    }

    g.bankrolls[user.id] -= bet;

    g.bets[user.id] =
      bet * 2;

    g.hands[user.id] = [
      ...hand,
      g.shoe.pop()
    ];

    g.done[user.id] = true;

    g.turn_user_id =
      nextTurn(g, user.id);
  }

  if (!g.turn_user_id) {
    g.phase = "dealer";
  }

  await saveGame(g);

  if (g.phase === "dealer") {
    await runDealer();
  }
}

function nextTurn(g, currentUserId) {
  const ids =
    lobbyPlayers
      .filter(
        player =>
          Number(
            g.bets?.[player.user_id] || 0
          ) > 0
      )
      .map(
        player => player.user_id
      );

  const currentIndex =
    ids.indexOf(currentUserId);

  for (
    let i = currentIndex + 1;
    i < ids.length;
    i++
  ) {
    const id = ids[i];

    if (!g.done?.[id]) {
      return id;
    }
  }

  return null;
}

/* =========================
   DEALER
========================= */

async function runDealer() {
  if (!currentLobby) return;

  if (currentLobby.host_id !== user.id) {
    return;
  }

  if (game?.phase !== "dealer") {
    return;
  }

  const g = currentGame();

  while (
    handValue(g.dealer).total < 17 &&
    g.shoe.length
  ) {
    g.dealer.push(
      g.shoe.pop()
    );
  }

  const dealerValue =
    handValue(g.dealer).total;

  const results = {};

  for (const player of lobbyPlayers) {
    const id = player.user_id;

    const bet =
      Number(g.bets?.[id] || 0);

    const hand =
      g.hands?.[id] || [];

    if (!bet || !hand.length) {
      continue;
    }

    const playerValue =
      handValue(hand).total;

    const playerBlackjack =
      isBlackjack(hand);

    const dealerBlackjack =
      isBlackjack(g.dealer);

    let payout = 0;
    let result = "";

    if (playerValue > 21) {
      result = "Bust — lose";
      payout = 0;
    } else if (
      playerBlackjack &&
      dealerBlackjack
    ) {
      result = "Push";
      payout = bet;
    } else if (
      playerBlackjack
    ) {
      result =
        "Blackjack — 3:2";

      payout =
        Math.floor(
          bet * 2.5
        );
    } else if (
      dealerBlackjack
    ) {
      result =
        "Dealer blackjack";
      payout = 0;
    } else if (
      dealerValue > 21
    ) {
      result =
        "Dealer bust — win";
      payout =
        bet * 2;
    } else if (
      playerValue > dealerValue
    ) {
      result = "Win";
      payout =
        bet * 2;
    } else if (
      playerValue === dealerValue
    ) {
      result = "Push";
      payout = bet;
    } else {
      result =
        "Dealer wins";
      payout = 0;
    }

    results[id] = result;

    if (payout > 0) {
      g.bankrolls[id] =
        Number(
          g.bankrolls[id] || 0
        ) + payout;
    }
  }

  g.results = results;
  g.phase = "finished";
  g.turn_user_id = null;

  g.message =
    `Dealer: ${dealerValue}. ` +
    `Start a new round when ready.`;

  await saveGame(g);
}

/* =========================
   NEW ROUND
========================= */

async function resetRound() {
  if (
    !currentLobby ||
    currentLobby.host_id !== user.id
  ) {
    return;
  }

  const bankrolls = {
    ...(game?.bankrolls || {})
  };

  const newGame = {
    phase: "waiting",
    shoe: [],
    dealer: [],
    hands: {},
    bets: {},
    bankrolls,
    done: {},
    results: {},
    ledger: {
      ...(game?.ledger || {})
    },
    turn_user_id: null,
    message: ""
  };

  await saveGame(newGame);
}

/* =========================
   SAVE GAME
========================= */

async function saveGame(nextGame) {
  if (!currentLobby) return;

  game = nextGame;

  let status = "waiting";

  if (game.phase === "finished") {
    status = "finished";
  } else if (
    game.phase === "playing" ||
    game.phase === "dealer"
  ) {
    status = "playing";
  }

  const {
    error
  } = await supabase
    .from("lobbies")
    .update({
      game,
      status
    })
    .eq(
      "id",
      currentLobby.id
    );

  if (error) {
    toast(
      `Game save failed: ${error.message}`
    );
    return;
  }

  renderTable();
}

/* =========================
   DEALER BANK / LEDGER
========================= */

function ledgerValue(id) {
  return Number(
    game?.ledger?.[id] || 0
  );
}

function renderDealerBank() {
  const panel =
    $("#dealerBankPanel");

  if (!panel) return;

  const isDealer =
    currentLobby?.host_id === user.id;

  panel.classList.toggle(
    "hidden",
    !isDealer
  );

  if (!isDealer) return;

  const select =
    $("#dealerPlayerSelect");

  if (!select) return;

  const previous =
    select.value;

  select.innerHTML =
    lobbyPlayers
      .filter(
        player =>
          player.user_id !== user.id
      )
      .map(player => `
        <option value="${player.user_id}">
          ${esc(
            player.profiles?.display_name ||
            "Player"
          )}
        </option>
      `)
      .join("");

  if (
    [...select.options]
      .some(
        option =>
          option.value === previous
      )
  ) {
    select.value = previous;
  }

  $("#dealerLedger").innerHTML =
    lobbyPlayers
      .filter(
        player =>
          player.user_id !== user.id
      )
      .map(player => {
        const amount =
          ledgerValue(
            player.user_id
          );

        const className =
          amount > 0
            ? "up"
            : amount < 0
              ? "down"
              : "even";

        const text =
          amount > 0
            ? `+${amount.toLocaleString()} (dealer owes)`
            : amount < 0
              ? `-${Math.abs(amount).toLocaleString()} (owes dealer)`
              : "0 (settled)";

        return `
          <div class="ledger-row">
            <span>
              ${esc(
                player.profiles?.display_name ||
                "Player"
              )}
            </span>

            <strong class="${className}">
              ${text}
            </strong>
          </div>
        `;
      })
      .join("") ||
    `<div class="muted small">
      No other players yet.
    </div>`;
}

async function dealerAdjust(direction) {
  if (
    currentLobby?.host_id !== user.id
  ) {
    toast(
      "Only the dealer can change the ledger."
    );
    return;
  }

  const target =
    $("#dealerPlayerSelect")?.value;

  const amount =
    Math.floor(
      Number(
        $("#dealerAmount")?.value
      )
    );

  if (!target) {
    toast(
      "Choose a player."
    );
    return;
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    toast(
      "Enter a positive amount."
    );
    return;
  }

  const g = currentGame();

  g.ledger = {
    ...(g.ledger || {})
  };

  g.ledger[target] =
    Number(g.ledger[target] || 0) +
    (
      direction === "give"
        ? amount
        : -amount
    );

  await saveGame(g);

  $("#dealerAmount").value = "";
}

/* =========================
   LEAVE TABLE
========================= */

async function leaveLobby() {
  if (!currentLobby) return;

  await supabase
    .from("lobby_players")
    .delete()
    .eq(
      "lobby_id",
      currentLobby.id
    )
    .eq(
      "user_id",
      user.id
    );

  if (lobbyChannel) {
    supabase.removeChannel(
      lobbyChannel
    );

    lobbyChannel = null;
  }

  currentLobby = null;
  lobbyPlayers = [];
  game = null;
  myBet = 0;

  show("home");

  await loadLobbies();
}

/* =========================
   BUTTONS
========================= */

function initializeButtons() {
  console.log(
    "Blackjack Friends: initializing buttons"
  );

  const createLobbyBtn =
    $("#createLobbyBtn");

  if (createLobbyBtn) {
    createLobbyBtn.onclick = () => {
      $("#createModal")
        ?.classList
        .remove("hidden");
    };
  }

  const confirmCreateLobby =
    $("#confirmCreateLobby");

  if (confirmCreateLobby) {
    confirmCreateLobby.onclick =
      createLobby;
  }

  const backHomeBtn =
    $("#backHomeBtn");

  if (backHomeBtn) {
    backHomeBtn.onclick = async () => {
      if (lobbyChannel) {
        supabase.removeChannel(
          lobbyChannel
        );

        lobbyChannel = null;
      }

      currentLobby = null;
      lobbyPlayers = [];
      game = null;

      show("home");

      await loadLobbies();
    };
  }

  const profileBtn =
    $("#profileBtn");

  if (profileBtn) {
    profileBtn.onclick = () => {
      $("#profileModal")
        ?.classList
        .remove("hidden");
    };
  }

  $$("[data-close]").forEach(button => {
    button.onclick = () => {
      const target =
        button.dataset.close;

      $(`#${target}`)
        ?.classList
        .add("hidden");
    };
  });

  const logoutBtn =
    $("#logoutBtn");

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await supabase.auth.signOut();
      window.location.href =
        "index.html";
    };
  }

  const copyCodeBtn =
    $("#copyCodeBtn");

  if (copyCodeBtn) {
    copyCodeBtn.onclick =
      async () => {
        if (!currentLobby) return;

        try {
          await navigator.clipboard.writeText(
            currentLobby.invite_code
          );

          toast(
            "Invite code copied."
          );
        } catch {
          toast(
            `Invite code: ${currentLobby.invite_code}`
          );
        }
      };
  }

  $$(".chip-btn").forEach(button => {
    button.onclick = () => {
      setBet(
        Number(button.dataset.bet)
      );
    };
  });

  const setBetBtn =
    $("#setBetBtn");

  if (setBetBtn) {
    setBetBtn.onclick = () => {
      setBet(
        Number(
          $("#customBet")?.value
        )
      );
    };
  }

  const startRoundBtn =
    $("#startRoundBtn");

  if (startRoundBtn) {
    startRoundBtn.onclick =
      async () => {
        if (game?.phase === "finished") {
          await resetRound();
        } else {
          await startRound();
        }
      };
  }

  const hitBtn =
    $("#hitBtn");

  if (hitBtn) {
    hitBtn.onclick =
      () => playerAction("hit");
  }

  const standBtn =
    $("#standBtn");

  if (standBtn) {
    standBtn.onclick =
      () => playerAction("stand");
  }

  const doubleBtn =
    $("#doubleBtn");

  if (doubleBtn) {
    doubleBtn.onclick =
      () => playerAction("double");
  }

  const dealerActionBtn =
    $("#dealerActionBtn");

  if (dealerActionBtn) {
    dealerActionBtn.onclick =
      runDealer;
  }

  const dealerGiveBtn =
    $("#dealerGiveBtn");

  if (dealerGiveBtn) {
    dealerGiveBtn.onclick =
      () => dealerAdjust("give");
  }

  const dealerTakeBtn =
    $("#dealerTakeBtn");

  if (dealerTakeBtn) {
    dealerTakeBtn.onclick =
      () => dealerAdjust("take");
  }

  const leaveLobbyBtn =
    $("#leaveLobbyBtn");

  if (leaveLobbyBtn) {
    leaveLobbyBtn.onclick =
      leaveLobby;
  }

  const chatForm =
    $("#chatForm");

  if (chatForm) {
    chatForm.onsubmit =
      async event => {
        event.preventDefault();

        if (!currentLobby) return;

        const input =
          $("#chatInput");

        const message =
          input.value.trim();

        if (!message) return;

        const {
          error
        } = await supabase
          .from("chat_messages")
          .insert({
            lobby_id:
              currentLobby.id,

            user_id:
              user.id,

            display_name:
              profile?.display_name ||
              "Player",

            message
          });

        if (error) {
          toast(error.message);
          return;
        }

        input.value = "";

        await loadChat();
      };
  }
}

/* =========================
   BOOT
========================= */

async function boot() {
  try {
    if (
      !cfg.SUPABASE_URL ||
      !cfg.SUPABASE_ANON_KEY
    ) {
      toast(
        "Supabase configuration is missing."
      );
      return;
    }

    const {
      data,
      error
    } = await supabase.auth.getSession();

    if (error) {
      toast(error.message);
      return;
    }

    if (!data.session) {
      window.location.href =
        "index.html";
      return;
    }

    user = data.session.user;

    const profileLoaded =
      await getProfile();

    if (!profileLoaded) {
      return;
    }

    renderBalance();

    show("home");

    await loadLobbies();

    console.log(
      "Blackjack Friends loaded successfully."
    );

  } catch (error) {
    console.error(
      "Blackjack Friends boot error:",
      error
    );

    toast(
      `Game error: ${error.message}`
    );
  }
}

/* =========================
   START
========================= */

initializeButtons();
boot();
