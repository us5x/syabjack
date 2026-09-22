const { createClient } = window.supabase;
const cfg = window.APP_CONFIG || {};
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let user = null;
let profile = null;

let currentLobby = null;
let lobbyPlayers = [];
let lobbyChannel = null;

let game = null;
let myBet = 0;

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];


/* =========================================================
   BASIC HELPERS
========================================================= */

function toast(msg) {
  const el = $("#toast");
  if (!el) return;

  el.textContent = msg;
  el.classList.add("show");

  clearTimeout(toast.t);
  toast.t = setTimeout(() => {
    el.classList.remove("show");
  }, 2600);
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
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
        shoe.push({
          rank,
          suit
        });
      }
    }
  }

  return shuffle(shoe);
}


/* =========================================================
   BLACKJACK RULES
========================================================= */

function handValue(cards = []) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.rank === "A") {
      total += 11;
      aces++;
    } else if (["K", "Q", "J"].includes(card.rank)) {
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

function isBust(cards = []) {
  return handValue(cards).total > 21;
}


/* =========================================================
   PROFILE / ACCOUNT
========================================================= */

async function getProfile() {
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
  const profileBalance = Number(profile?.balance || 0);

  if ($("#profileBalance")) {
    $("#profileBalance").textContent =
      profileBalance.toLocaleString();
  }

  if ($("#profileName")) {
    $("#profileName").textContent =
      profile?.display_name || "Player";
  }

  if ($("#profileEmail")) {
    $("#profileEmail").textContent =
      profile?.email || "";
  }

  /*
    Outside a lobby, show the account balance.
    Inside a lobby, show the table bankroll.
  */
  if ($("#topBalance")) {
    if (currentLobby && game) {
      $("#topBalance").textContent =
        tableBankroll(user.id).toLocaleString();
    } else {
      $("#topBalance").textContent =
        profileBalance.toLocaleString();
    }
  }
}


/* =========================================================
   TABLE BANKROLL
========================================================= */

function startingChips() {
  return Number(currentLobby?.starting_chips || 5000);
}

function tableBankroll(id) {
  if (!currentLobby) return 0;

  if (!game) {
    return id === user?.id ? startingChips() : 0;
  }

  if (!game.bankrolls) {
    return id === user?.id ? startingChips() : 0;
  }

  const value = Number(game.bankrolls[id]);

  if (!Number.isFinite(value)) {
    return id === user?.id ? startingChips() : 0;
  }

  return value;
}

function ensureBankrolls(sourceGame) {
  const g = sourceGame;

  if (!g.bankrolls) {
    g.bankrolls = {};
  }

  for (const player of lobbyPlayers) {
    if (!Number.isFinite(Number(g.bankrolls[player.user_id]))) {
      g.bankrolls[player.user_id] = startingChips();
    }
  }

  return g;
}


/* =========================================================
   VIEWS
========================================================= */

function show(view) {
  const home = $("#homeView");
  const lobby = $("#lobbyView");

  if (!home || !lobby) return;

  home.classList.toggle("hidden", view !== "home");
  lobby.classList.toggle("hidden", view !== "lobby");
}


/* =========================================================
   LOBBIES
========================================================= */

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
        <span>🪙 ${Number(lobby.starting_chips || 0).toLocaleString()}</span>
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
    button.onclick = () => joinLobby(button.dataset.id);
  });
}

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

async function createLobby() {
  const name =
    $("#newLobbyName")?.value.trim() ||
    "Friends Table";

  const starting =
    Number($("#newStartingChips")?.value) || 5000;

  if (starting <= 0) {
    toast("Starting chips must be greater than 0.");
    return;
  }

  const code =
    Math.random()
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
      game: initialGame
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

  if ($("#createModal")) {
    $("#createModal").classList.add("hidden");
  }

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
    error: playersError
  } = await supabase
    .from("lobby_players")
    .select("*, profiles(display_name,balance,email)")
    .eq("lobby_id", id)
    .order("seat");

  if (playersError) {
    toast(playersError.message);
    return;
  }

  if (!players.some(p => p.user_id === user.id)) {
    const usedSeats =
      new Set(players.map(p => p.seat));

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

  /*
    Make sure everyone who joins has table chips.
  */
  if (!game.bankrolls) {
    game.bankrolls = {};
  }

  if (!Number.isFinite(Number(game.bankrolls[user.id]))) {
    game.bankrolls[user.id] = startingChips();

    await supabase
      .from("lobbies")
      .update({ game })
      .eq("id", currentLobby.id);
  }

  await refreshLobby();

  subscribeLobby();

  show("lobby");

  renderBalance();
}


/* =========================================================
   LOBBY REFRESH / REALTIME
========================================================= */

async function refreshLobby() {
  if (!currentLobby) return;

  const {
    data: lobby,
    error: lobbyError
  } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", currentLobby.id)
    .single();

  if (lobbyError) {
    toast(lobbyError.message);
    return;
  }

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

  const {
    data: players,
    error: playersError
  } = await supabase
    .from("lobby_players")
    .select("*, profiles(display_name,balance,email)")
    .eq("lobby_id", currentLobby.id)
    .order("seat");

  if (playersError) {
    toast(playersError.message);
    return;
  }

  lobbyPlayers = players || [];

  if ($("#lobbyTitle")) {
    $("#lobbyTitle").textContent =
      currentLobby.name;
  }

  if ($("#copyCodeBtn")) {
    $("#copyCodeBtn").textContent =
      currentLobby.invite_code;
  }

  if ($("#playerCount")) {
    $("#playerCount").textContent =
      `${lobbyPlayers.length} / 7`;
  }

  const host = lobbyPlayers.find(
    p => p.user_id === currentLobby.host_id
  );

  if ($("#hostLabel")) {
    $("#hostLabel").textContent =
      `Host: ${host?.profiles?.display_name || "—"}`;
  }

  myBet =
    Number(game?.bets?.[user.id] || 0);

  if ($("#currentBet")) {
    $("#currentBet").textContent =
      myBet.toLocaleString();
  }

  renderTable();
  renderBalance();

  await loadChat();
}

function subscribeLobby() {
  if (lobbyChannel) {
    supabase.removeChannel(lobbyChannel);
  }

  lobbyChannel =
    supabase
      .channel("lobby-" + currentLobby.id)

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


/* =========================================================
   CHAT
========================================================= */

async function loadChat() {
  if (!currentLobby || !$("#chatLog")) return;

  const { data } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("lobby_id", currentLobby.id)
    .order("created_at", {
      ascending: true
    })
    .limit(80);

  $("#chatLog").innerHTML =
    (data || [])
      .map(message => `
        <div class="chat-msg">
          <strong>${esc(message.display_name)}</strong>
          ${esc(message.message)}
        </div>
      `)
      .join("");

  $("#chatLog").scrollTop =
    $("#chatLog").scrollHeight;
}


/* =========================================================
   CARDS / TABLE RENDERING
========================================================= */

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

function nameOf(id) {
  return (
    lobbyPlayers.find(
      player => player.user_id === id
    )?.profiles?.display_name ||
    "player"
  );
}

function renderTable() {
  if (!currentLobby || !game) return;

  const dealer =
    game.dealer || [];

  const hideHole =
    game.phase === "playing" &&
    dealer.length >= 2;

  if ($("#dealerCards")) {
    $("#dealerCards").innerHTML =
      dealer
        .map((card, index) =>
          cardHtml(
            card,
            hideHole && index === 1
          )
        )
        .join("");
  }

  if ($("#dealerMeta")) {
    if (hideHole) {
      $("#dealerMeta").textContent =
        "Hole card hidden";
    } else if (dealer.length) {
      $("#dealerMeta").textContent =
        `Total ${handValue(dealer).total}`;
    } else {
      $("#dealerMeta").textContent = "";
    }
  }

  const phase =
    game.phase || "waiting";

  if ($("#tableStatus")) {
    if (phase === "waiting") {
      $("#tableStatus").textContent =
        "Place your bets, then the host deals.";
    } else if (phase === "playing") {
      if (game.turn_user_id === user.id) {
        $("#tableStatus").textContent =
          "Your turn.";
      } else {
        $("#tableStatus").textContent =
          `Waiting for ${nameOf(game.turn_user_id)}…`;
      }
    } else if (phase === "dealer") {
      $("#tableStatus").textContent =
        "Dealer is resolving the hand.";
    } else if (phase === "finished") {
      $("#tableStatus").textContent =
        game.message ||
        "Round finished.";
    }
  }

  if ($("#playersZone")) {
    $("#playersZone").innerHTML =
      lobbyPlayers
        .map(player => {
          const id =
            player.user_id;

          const hand =
            game.hands?.[id] || [];

          const value =
            handValue(hand);

          const bet =
            Number(game.bets?.[id] || 0);

          const result =
            game.results?.[id];

          const bankroll =
            tableBankroll(id);

          const isMe =
            id === user.id;

          const isDone =
            !!game.done?.[id];

          return `
            <div class="seat ${isMe ? "me" : ""}">

              <div class="seat-name">
                ${esc(
                  player.profiles?.display_name ||
                  "Player"
                )}
              </div>

              ${
                id === currentLobby.host_id
                  ? `<div class="seat-host">HOST / DEALER</div>`
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
                      ${isDone ? " · done" : ""}
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
  }

  const myHand =
    game.hands?.[user.id] || [];

  const myTurn =
    game.phase === "playing" &&
    game.turn_user_id === user.id;

  if ($("#playerActions")) {
    $("#playerActions")
      .classList.toggle(
        "hidden",
        !myTurn
      );
  }

  if ($("#dealerActionBtn")) {
    $("#dealerActionBtn")
      .classList.toggle(
        "hidden",
        !(
          game.phase === "dealer" &&
          currentLobby.host_id === user.id
        )
      );
  }

  /*
    Host can start a new round when waiting
    OR reset after a finished round.
  */
  if ($("#startRoundBtn")) {
    const host =
      currentLobby.host_id === user.id;

    const visible =
      host &&
      (
        phase === "waiting" ||
        phase === "finished"
      );

    $("#startRoundBtn")
      .classList.toggle(
        "hidden",
        !visible
      );

    $("#startRoundBtn").textContent =
      phase === "finished"
        ? "New round"
        : "Deal round";
  }

  if ($("#doubleBtn")) {
    $("#doubleBtn").disabled =
      !(
        myTurn &&
        myHand.length === 2 &&
        tableBankroll(user.id) >= myBet
      );
  }

  renderDealerBank();
}


/* =========================================================
   BETTING
========================================================= */

async function setBet(amount) {
  amount = Number(amount);

  if (!Number.isFinite(amount)) {
    toast("Enter a valid bet.");
    return;
  }

  amount = Math.floor(amount);

  if (amount < 5) {
    toast("Minimum bet is 5.");
    return;
  }

  if (amount % 5 !== 0) {
    toast("Bet must be a multiple of 5.");
    return;
  }

  if (game?.phase !== "waiting") {
    toast("You can only change your bet before the deal.");
    return;
  }

  const bankroll =
    tableBankroll(user.id);

  if (amount > bankroll) {
    toast("You do not have enough table chips.");
    return;
  }

  const g = currentGame();

  g.bankrolls =
    g.bankrolls || {};

  g.bets =
    g.bets || {};

  g.bets[user.id] =
    amount;

  /*
    Ensure the player has a table bankroll.
  */
  if (!Number.isFinite(
    Number(g.bankrolls[user.id])
  )) {
    g.bankrolls[user.id] =
      startingChips();
  }

  myBet = amount;

  await saveGame(g);
}


/* =========================================================
   START ROUND
========================================================= */

async function startRound() {
  if (!currentLobby) return;

  if (currentLobby.host_id !== user.id) {
    toast("Only the dealer can deal.");
    return;
  }

  /*
    If previous round finished,
    clear the previous hand but keep
    everyone's table bankroll.
  */
  if (game?.phase === "finished") {
    game = {
      phase: "waiting",
      shoe: [],
      dealer: [],
      hands: {},
      bets: {},
      bankrolls: {
        ...(game.bankrolls || {})
      },
      done: {},
      results: {},
      ledger: {
        ...(game.ledger || {})
      },
      turn_user_id: null,
      message: ""
    };

    ensureBankrolls(game);

    await saveGame(game);
    return;
  }

  const g = currentGame();

  ensureBankrolls(g);

  g.bets =
    g.bets || {};

  const activePlayers =
    lobbyPlayers.filter(player => {
      const bet =
        Number(g.bets[player.user_id] || 0);

      const chips =
        Number(g.bankrolls[player.user_id] || 0);

      return bet > 0 && chips >= bet;
    });

  if (!activePlayers.length) {
    toast("At least one player needs a valid bet.");
    return;
  }

  /*
    Validate every bet before dealing.
  */
  for (const player of activePlayers) {
    const bet =
      Number(g.bets[player.user_id]);

    const chips =
      Number(g.bankrolls[player.user_id] || 0);

    if (bet < 5) {
      toast(
        `${nameOf(player.user_id)} has an invalid bet.`
      );
      return;
    }

    if (bet > chips) {
      toast(
        `${nameOf(player.user_id)} does not have enough chips.`
      );
      return;
    }
  }

  const shoe =
    makeShoe(6);

  const hands = {};

  /*
    Deal two cards to every player.
  */
  for (const player of activePlayers) {
    hands[player.user_id] = [
      shoe.pop(),
      shoe.pop()
    ];
  }

  /*
    Dealer gets two cards.
  */
  const dealer = [
    shoe.pop(),
    shoe.pop()
  ];

  const bets = {
    ...g.bets
  };

  const bankrolls = {
    ...g.bankrolls
  };

  const done = {};

  /*
    Remove each wager from the player's
    table bankroll.
  */
  for (const player of activePlayers) {
    const id =
      player.user_id;

    const bet =
      Number(bets[id]);

    bankrolls[id] =
      Number(bankrolls[id] || 0) - bet;
  }

  /*
    Natural blackjacks do not need a turn.
  */
  for (const player of activePlayers) {
    const id =
      player.user_id;

    const hand =
      hands[id];

    if (
      isBlackjack(hand) ||
      isBust(hand)
    ) {
      done[id] = true;
    } else {
      done[id] = false;
    }
  }

  /*
    Find first player who actually needs
    to make a decision.
  */
  let firstTurn = null;

  for (const player of activePlayers) {
    if (!done[player.user_id]) {
      firstTurn = player.user_id;
      break;
    }
  }

  const nextGame = {
    phase:
      firstTurn
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
      ...(g.ledger || {})
    },

    turn_user_id:
      firstTurn,

    message: ""
  };

  await saveGame(nextGame);
}


/* =========================================================
   PLAYER ACTIONS
========================================================= */

async function playerAction(type) {
  if (!game) return;

  if (
    game.phase !== "playing" ||
    game.turn_user_id !== user.id
  ) {
    return;
  }

  const g =
    currentGame();

  const hand =
    g.hands[user.id] || [];

  const bet =
    Number(g.bets[user.id] || 0);

  if (!bet) {
    toast("You do not have a bet.");
    return;
  }

  /*
    HIT
  */
  if (type === "hit") {
    const card =
      g.shoe.pop();

    if (!card) {
      toast("The shoe is empty.");
      return;
    }

    g.hands[user.id] =
      [...hand, card];

    const value =
      handValue(g.hands[user.id]);

    /*
      Bust or 21 automatically ends
      the player's turn.
    */
    if (value.total >= 21) {
      g.done[user.id] = true;

      g.turn_user_id =
        nextTurn(g, user.id);
    }
  }

  /*
    STAND
  */
  else if (type === "stand") {
    g.done[user.id] = true;

    g.turn_user_id =
      nextTurn(g, user.id);
  }

  /*
    DOUBLE DOWN
  */
  else if (type === "double") {
    if (hand.length !== 2) {
      toast("You can only double on your first two cards.");
      return;
    }

    const bankroll =
      Number(g.bankrolls[user.id] || 0);

    if (bankroll < bet) {
      toast("Not enough chips to double.");
      return;
    }

    /*
      Put another equal wager down.
    */
    g.bankrolls[user.id] =
      bankroll - bet;

    g.bets[user.id] =
      bet * 2;

    const card =
      g.shoe.pop();

    if (!card) {
      toast("The shoe is empty.");
      return;
    }

    g.hands[user.id] =
      [...hand, card];

    /*
      Double always ends the turn.
    */
    g.done[user.id] = true;

    g.turn_user_id =
      nextTurn(g, user.id);
  }

  /*
    If nobody is left to play,
    move to dealer phase.
  */
  if (!g.turn_user_id) {
    g.phase = "dealer";
  }

  await saveGame(g);

  renderBalance();
}


/* =========================================================
   TURN MANAGEMENT
========================================================= */

function nextTurn(g, currentId) {
  const players =
    lobbyPlayers
      .filter(player => {
        const id =
          player.user_id;

        const bet =
          Number(g.bets?.[id] || 0);

        return (
          bet > 0 &&
          !g.done?.[id]
        );
      })
      .map(player => player.user_id);

  if (!players.length) {
    return null;
  }

  const allPlayers =
    lobbyPlayers.map(
      player => player.user_id
    );

  const currentIndex =
    allPlayers.indexOf(currentId);

  /*
    Continue clockwise from the current player.
  */
  for (
    let offset = 1;
    offset <= allPlayers.length;
    offset++
  ) {
    const index =
      (currentIndex + offset) %
      allPlayers.length;

    const candidate =
      allPlayers[index];

    if (players.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}


/* =========================================================
   DEALER
========================================================= */

async function runDealer() {
  if (!currentLobby) return;

  if (currentLobby.host_id !== user.id) {
    toast("Only the dealer can resolve the hand.");
    return;
  }

  if (game?.phase !== "dealer") {
    return;
  }

  const g =
    currentGame();

  /*
    Dealer stands on all 17,
    including soft 17.
  */
  while (
    handValue(g.dealer).total < 17
  ) {
    const card =
      g.shoe.pop();

    if (!card) break;

    g.dealer.push(card);
  }

  const dealerValue =
    handValue(g.dealer).total;

  const dealerBlackjack =
    isBlackjack(g.dealer);

  const results = {};

  for (const player of lobbyPlayers) {
    const id =
      player.user_id;

    const bet =
      Number(g.bets?.[id] || 0);

    if (!bet) continue;

    const hand =
      g.hands?.[id] || [];

    const playerValue =
      handValue(hand).total;

    const playerBlackjack =
      isBlackjack(hand);

    let payout = 0;
    let resultText = "";

    /*
      PLAYER BUST
    */
    if (playerValue > 21) {
      payout = 0;
      resultText = "Bust — lose";
    }

    /*
      BOTH NATURAL BLACKJACKS
    */
    else if (
      playerBlackjack &&
      dealerBlackjack
    ) {
      payout = bet;
      resultText = "Blackjack — push";
    }

    /*
      PLAYER NATURAL BLACKJACK
    */
    else if (
      playerBlackjack &&
      !dealerBlackjack
    ) {
      /*
        Original wager is already removed.
        Return wager + 3:2 winnings.
      */
      payout =
        bet * 2.5;

      resultText =
        "Blackjack — pays 3:2";
    }

    /*
      DEALER NATURAL
    */
    else if (
      dealerBlackjack &&
      !playerBlackjack
    ) {
      payout = 0;
      resultText =
        "Dealer blackjack — lose";
    }

    /*
      DEALER BUST
    */
    else if (
      dealerValue > 21
    ) {
      payout =
        bet * 2;

      resultText =
        "Win — dealer busts";
    }

    /*
      PLAYER HIGHER
    */
    else if (
      playerValue > dealerValue
    ) {
      payout =
        bet * 2;

      resultText =
        "Win";
    }

    /*
      PUSH
    */
    else if (
      playerValue === dealerValue
    ) {
      payout =
        bet;

      resultText =
        "Push";
    }

    /*
      DEALER HIGHER
    */
    else {
      payout = 0;
      resultText =
        "Dealer wins";
    }

    /*
      Return winnings/pushes to the
      player's table bankroll.
    */
    g.bankrolls[id] =
      Number(g.bankrolls[id] || 0) +
      payout;

    results[id] =
      resultText;
  }

  g.results =
    results;

  g.phase =
    "finished";

  g.turn_user_id =
    null;

  g.message =
    `Dealer: ${dealerValue}.`;

  await saveGame(g);

  renderBalance();
}


/* =========================================================
   NEW ROUND
========================================================= */

async function resetRound() {
  if (!currentLobby) return;

  if (currentLobby.host_id !== user.id) {
    toast("Only the dealer can start a new round.");
    return;
  }

  const g = {
    phase: "waiting",

    shoe: [],

    dealer: [],

    hands: {},

    bets: {},

    bankrolls: {
      ...(game?.bankrolls || {})
    },

    done: {},

    results: {},

    ledger: {
      ...(game?.ledger || {})
    },

    turn_user_id: null,

    message: ""
  };

  ensureBankrolls(g);

  await saveGame(g);

  renderBalance();
}


/* =========================================================
   DEALER BANK / LEDGER
========================================================= */

function ledgerValue(id) {
  return Number(
    game?.ledger?.[id] || 0
  );
}

function ledgerLabel(id) {
  const value =
    ledgerValue(id);

  if (value > 0) {
    return `
      <span class="up">
        Dealer owes ${value.toLocaleString()}
      </span>
    `;
  }

  if (value < 0) {
    return `
      <span class="down">
        Owes dealer ${Math.abs(value).toLocaleString()}
      </span>
    `;
  }

  return `<span>Settled</span>`;
}

function renderDealerBank() {
  if (
    !currentLobby ||
    !game ||
    !$("#dealerBankPanel")
  ) {
    return;
  }

  const isDealer =
    currentLobby.host_id === user.id;

  $("#dealerBankPanel")
    .classList.toggle(
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
      .map(
        player => `
          <option value="${player.user_id}">
            ${esc(
              player.profiles?.display_name ||
              "Player"
            )}
          </option>
        `
      )
      .join("");

  if (
    [...select.options]
      .some(
        option =>
          option.value === previous
      )
  ) {
    select.value =
      previous;
  }

  if ($("#dealerLedger")) {
    $("#dealerLedger").innerHTML =
      lobbyPlayers
        .filter(
          player =>
            player.user_id !== user.id
        )
        .map(player => {
          const value =
            ledgerValue(
              player.user_id
            );

          const className =
            value > 0
              ? "up"
              : value < 0
                ? "down"
                : "even";

          const text =
            value > 0
              ? `+${value.toLocaleString()} (dealer owes)`
              : value < 0
                ? `-${Math.abs(value).toLocaleString()} (owes dealer)`
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
}

async function dealerAdjust(direction) {
  if (
    !currentLobby ||
    currentLobby.host_id !== user.id
  ) {
    toast("Only the dealer can change the ledger.");
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
    toast("Choose a player.");
    return;
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    toast("Enter a positive amount.");
    return;
  }

  const g =
    currentGame();

  g.ledger =
    g.ledger || {};

  const oldValue =
    Number(g.ledger[target] || 0);

  g.ledger[target] =
    oldValue +
    (
      direction === "give"
        ? amount
        : -amount
    );

  await saveGame(g);

  if ($("#dealerAmount")) {
    $("#dealerAmount").value = "";
  }
}


/* =========================================================
   SAVE GAME
========================================================= */

function currentGame() {
  return JSON.parse(
    JSON.stringify(
      game || {}
    )
  );
}

async function saveGame(next) {
  if (!currentLobby) return;

  game = next;

  const status =
    game.phase === "waiting"
      ? "waiting"
      : game.phase === "finished"
        ? "finished"
        : "playing";

  const { error } =
    await supabase
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
    toast(error.message);
    return;
  }

  renderTable();
  renderBalance();
}


/* =========================================================
   LEAVE LOBBY
========================================================= */

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
  game = null;
  lobbyPlayers = [];

  show("home");

  await loadLobbies();

  renderBalance();
}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {
  await supabase.auth.signOut();
}


/* =========================================================
   AUTH / PAGE STARTUP
========================================================= */

async function boot() {
  if (!supabase) {
    toast(
      "Supabase configuration is missing."
    );
    return;
  }

  const {
    data
  } = await supabase.auth.getSession();

  if (data.session) {
    user =
      data.session.user;

    await getProfile();

    /*
      If this is game.html, load the game.
    */
    if (
      window.location.pathname.endsWith(
        "/game.html"
      )
    ) {
      await enterGame();
    }
  } else {
    /*
      If game.html is opened without a session,
      send the user back to login.
    */
    if (
      window.location.pathname.endsWith(
        "/game.html"
      )
    ) {
      window.location.replace(
        "index.html"
      );
    }
  }

  supabase.auth.onAuthStateChange(
    async (_event, session) => {
      user =
        session?.user || null;

      if (!user) {
        window.location.replace(
          "index.html"
        );
        return;
      }

      await getProfile();

      if (
        window.location.pathname.endsWith(
          "/game.html"
        )
      ) {
        await enterGame();
      } else {
        window.location.replace(
          "game.html"
        );
      }
    }
  );
}

async function enterGame() {
  if (!user) return;

  if ($("#appView")) {
    $("#appView")
      .classList.remove("hidden");
  }

  if ($("#authView")) {
    $("#authView")
      .classList.add("hidden");
  }

  renderBalance();

  await loadLobbies();
}


/* =========================================================
   BUTTONS / EVENTS
========================================================= */

function initializeButtons() {

  /*
    Home
  */

  if ($("#createLobbyBtn")) {
    $("#createLobbyBtn").onclick =
      () => {
        $("#createModal")
          ?.classList
          .remove("hidden");
      };
  }

  if ($("#confirmCreateLobby")) {
    $("#confirmCreateLobby").onclick =
      createLobby;
  }

  if ($("#backHomeBtn")) {
    $("#backHomeBtn").onclick =
      async () => {
        if (lobbyChannel) {
          supabase.removeChannel(
            lobbyChannel
          );
          lobbyChannel = null;
        }

        currentLobby = null;
        game = null;
        lobbyPlayers = [];

        show("home");

        await loadLobbies();

        renderBalance();
      };
  }


  /*
    Profile
  */

  if ($("#profileBtn")) {
    $("#profileBtn").onclick =
      () => {
        $("#profileModal")
          ?.classList
          .remove("hidden");
      };
  }

  $$("[data-close]").forEach(button => {
    button.onclick = () => {
      const target =
        button.dataset.close;

      if (target) {
        $("#" + target)
          ?.classList
          .add("hidden");
      }
    };
  });

  if ($("#logoutBtn")) {
    $("#logoutBtn").onclick =
      logout;
  }


  /*
    Invite code
  */

  if ($("#copyCodeBtn")) {
    $("#copyCodeBtn").onclick =
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


  /*
    Betting
  */

  $$(".chip-btn").forEach(button => {
    button.onclick =
      () => {
        setBet(
          Number(
            button.dataset.bet
          )
        );
      };
  });

  if ($("#setBetBtn")) {
    $("#setBetBtn").onclick =
      () => {
        setBet(
          Number(
            $("#customBet").value
          )
        );
      };
  }


  /*
    Deal / new round
  */

  if ($("#startRoundBtn")) {
    $("#startRoundBtn").onclick =
      async () => {
        if (
          game?.phase ===
          "finished"
        ) {
          await resetRound();
        } else {
          await startRound();
        }
      };
  }


  /*
    Player actions
  */

  if ($("#hitBtn")) {
    $("#hitBtn").onclick =
      () => playerAction("hit");
  }

  if ($("#standBtn")) {
    $("#standBtn").onclick =
      () => playerAction("stand");
  }

  if ($("#doubleBtn")) {
    $("#doubleBtn").onclick =
      () => playerAction("double");
  }


  /*
    Dealer
  */

  if ($("#dealerActionBtn")) {
    $("#dealerActionBtn").onclick =
      runDealer;
  }

  if ($("#dealerGiveBtn")) {
    $("#dealerGiveBtn").onclick =
      () =>
        dealerAdjust("give");
  }

  if ($("#dealerTakeBtn")) {
    $("#dealerTakeBtn").onclick =
      () =>
        dealerAdjust("take");
  }


  /*
    Leave
  */

  if ($("#leaveLobbyBtn")) {
    $("#leaveLobbyBtn").onclick =
      leaveLobby;
  }


  /*
    Chat
  */

  if ($("#chatForm")) {
    $("#chatForm").onsubmit =
      async event => {
        event.preventDefault();

        if (!currentLobby || !user) {
          return;
        }

        const input =
          $("#chatInput");

        const message =
          input?.value.trim();

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
      };
  }
}


/* =========================================================
   START
========================================================= */

initializeButtons();
boot();
