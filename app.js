/* =========================================================
   BLACKJACK FRIENDS
   Complete app.js
========================================================= */

"use strict";

/* =========================================================
   CONFIG / SUPABASE
========================================================= */

const APP_CONFIG = window.APP_CONFIG || {};

let supabase = null;

let user = null;
let profile = null;
let currentLobby = null;
let lobbyPlayers = [];
let lobbyChannel = null;
let game = null;
let myBet = 0;

/* =========================================================
   DOM HELPERS
========================================================= */

function byId(id) {
  return document.getElementById(id);
}

function all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function showElement(id) {
  const el = byId(id);
  if (el) {
    el.classList.remove("hidden");
  }
}

function hideElement(id) {
  const el = byId(id);
  if (el) {
    el.classList.add("hidden");
  }
}

function toggleElement(id, hidden) {
  const el = byId(id);
  if (el) {
    el.classList.toggle("hidden", hidden);
  }
}

/* =========================================================
   TOAST
========================================================= */

let toastTimer = null;

function toast(message) {
  const el = byId("toast");

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = String(message);
  el.classList.add("show");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    function (character) {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };

      return map[character];
    }
  );
}

function cloneGame() {
  return JSON.parse(JSON.stringify(game || {}));
}

function playerName(userId) {
  const player = lobbyPlayers.find(
    function (item) {
      return item.user_id === userId;
    }
  );

  return (
    player?.profiles?.display_name ||
    "Player"
  );
}

/* =========================================================
   BLACKJACK
========================================================= */

const SUITS = ["♠", "♥", "♦", "♣"];

const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
];

function shuffle(array) {
  for (
    let index = array.length - 1;
    index > 0;
    index--
  ) {
    const randomIndex = Math.floor(
      Math.random() * (index + 1)
    );

    const temporary = array[index];

    array[index] = array[randomIndex];
    array[randomIndex] = temporary;
  }

  return array;
}

function makeShoe(decks) {
  const numberOfDecks = decks || 6;
  const shoe = [];

  for (
    let deck = 0;
    deck < numberOfDecks;
    deck++
  ) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({
          rank: rank,
          suit: suit
        });
      }
    }
  }

  return shuffle(shoe);
}

function handValue(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards || []) {
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
    total: total,
    soft: aces > 0
  };
}

function isBlackjack(cards) {
  if (!cards || cards.length !== 2) {
    return false;
  }

  return handValue(cards).total === 21;
}

/* =========================================================
   VIEW MANAGEMENT
========================================================= */

function showView(view) {
  const home = byId("homeView");
  const lobby = byId("lobbyView");

  if (home) {
    home.classList.toggle(
      "hidden",
      view !== "home"
    );
  }

  if (lobby) {
    lobby.classList.toggle(
      "hidden",
      view !== "lobby"
    );
  }
}

/* =========================================================
   MODALS
========================================================= */

function openModal(id) {
  const modal = byId(id);

  if (!modal) {
    toast("The requested window could not be found.");
    return;
  }

  modal.classList.remove("hidden");
}

function closeModal(id) {
  const modal = byId(id);

  if (modal) {
    modal.classList.add("hidden");
  }
}

/* =========================================================
   PROFILE
========================================================= */

async function loadProfile() {
  if (!user || !user.id) {
    return false;
  }

  const result = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (result.error) {
    console.error(
      "Profile error:",
      result.error
    );

    toast(
      "Could not load your profile: " +
      result.error.message
    );

    return false;
  }

  profile = result.data;

  renderProfile();

  return true;
}

function renderProfile() {
  const balance = Number(
    profile?.balance || 0
  );

  const topBalance = byId("topBalance");

  if (topBalance) {
    topBalance.textContent =
      balance.toLocaleString();
  }

  const profileBalance =
    byId("profileBalance");

  if (profileBalance) {
    profileBalance.textContent =
      balance.toLocaleString();
  }

  const profileName =
    byId("profileName");

  if (profileName) {
    profileName.textContent =
      profile?.display_name ||
      "Player";
  }

  const profileEmail =
    byId("profileEmail");

  if (profileEmail) {
    profileEmail.textContent =
      profile?.email ||
      user?.email ||
      "";
  }
}

/* =========================================================
   HOME / LOBBIES
========================================================= */

async function loadLobbies() {
  if (!supabase) {
    return;
  }

  const result = await supabase
    .from("lobbies")
    .select("*")
    .order("created_at", {
      ascending: false
    });

  if (result.error) {
    console.error(
      "Lobby loading error:",
      result.error
    );

    toast(
      "Could not load tables: " +
      result.error.message
    );

    return;
  }

  renderLobbies(result.data || []);
}

function renderLobbies(rows) {
  const list = byId("lobbyList");
  const empty = byId("emptyLobbies");

  if (!list || !empty) {
    return;
  }

  if (!rows.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  list.innerHTML = rows
    .map(function (lobby) {
      return `
        <div class="lobby-card">
          <div class="eyebrow">OPEN TABLE</div>

          <h4>${escapeHtml(lobby.name)}</h4>

          <div class="lobby-meta">
            <span>♟ Private</span>
            <span>
              🪙 ${Number(
                lobby.starting_chips || 5000
              ).toLocaleString()}
            </span>
            <span>
              ${escapeHtml(
                lobby.status || "waiting"
              )}
            </span>
          </div>

          <button
            type="button"
            class="secondary join-btn"
            data-lobby-id="${escapeHtml(
              lobby.id
            )}"
          >
            Join table
          </button>
        </div>
      `;
    })
    .join("");
}

/* =========================================================
   CREATE TABLE
========================================================= */

function openCreateLobby() {
  console.log(
    "Blackjack Friends: New Table clicked"
  );

  openModal("createModal");
}

async function createLobby() {
  if (!user) {
    toast("You are not logged in.");
    return;
  }

  if (!supabase) {
    toast("Supabase is not ready yet.");
    return;
  }

  const nameInput =
    byId("newLobbyName");

  const chipsInput =
    byId("newStartingChips");

  const name =
    nameInput?.value.trim() ||
    "Friends Table";

  const starting =
    Number(chipsInput?.value) || 5000;

  if (starting < 100) {
    toast(
      "Starting chips must be at least 100."
    );
    return;
  }

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

  console.log(
    "Creating lobby:",
    name,
    starting
  );

  const result = await supabase
    .from("lobbies")
    .insert({
      name: name,
      invite_code: code,
      host_id: user.id,
      starting_chips: starting,
      game: initialGame,
      status: "waiting"
    })
    .select()
    .single();

  if (result.error) {
    console.error(
      "Create lobby error:",
      result.error
    );

    toast(
      "Could not create table: " +
      result.error.message
    );

    return;
  }

  console.log(
    "Lobby created:",
    result.data
  );

  const playerResult =
    await supabase
      .from("lobby_players")
      .insert({
        lobby_id: result.data.id,
        user_id: user.id,
        seat: 1
      });

  if (playerResult.error) {
    console.error(
      "Host join error:",
      playerResult.error
    );

    toast(
      "Table was created, but joining failed: " +
      playerResult.error.message
    );

    return;
  }

  closeModal("createModal");

  await joinLobby(result.data.id);
}

/* =========================================================
   JOIN LOBBY
========================================================= */

async function joinLobby(lobbyId) {
  if (!supabase || !user) {
    return;
  }

  const lobbyResult = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", lobbyId)
    .single();

  if (lobbyResult.error) {
    toast(
      "Could not open table: " +
      lobbyResult.error.message
    );

    return;
  }

  const lobby = lobbyResult.data;

  const playersResult =
    await supabase
      .from("lobby_players")
      .select(
        "*, profiles(display_name,balance,email)"
      )
      .eq("lobby_id", lobbyId)
      .order("seat");

  if (playersResult.error) {
    toast(
      "Could not load players: " +
      playersResult.error.message
    );

    return;
  }

  let players =
    playersResult.data || [];

  const alreadyJoined =
    players.some(function (player) {
      return player.user_id === user.id;
    });

  if (!alreadyJoined) {
    const usedSeats = new Set(
      players.map(function (player) {
        return player.seat;
      })
    );

    let seat = 1;

    while (usedSeats.has(seat)) {
      seat++;
    }

    if (seat > 7) {
      toast("This table is full.");
      return;
    }

    const joinResult =
      await supabase
        .from("lobby_players")
        .insert({
          lobby_id: lobbyId,
          user_id: user.id,
          seat: seat
        });

    if (joinResult.error) {
      toast(
        "Could not join table: " +
        joinResult.error.message
      );

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

  if (
    game.bankrolls[user.id] === undefined
  ) {
    game.bankrolls[user.id] =
      Number(
        lobby.starting_chips || 5000
      );
  }

  await refreshLobby();

  subscribeLobby();

  showView("lobby");
}

/* =========================================================
   REFRESH CURRENT LOBBY
========================================================= */

async function refreshLobby() {
  if (!currentLobby || !supabase) {
    return;
  }

  const lobbyResult =
    await supabase
      .from("lobbies")
      .select("*")
      .eq("id", currentLobby.id)
      .single();

  if (lobbyResult.error) {
    console.error(
      "Refresh lobby error:",
      lobbyResult.error
    );

    return;
  }

  currentLobby = lobbyResult.data;

  game = currentLobby.game || {
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

  const playersResult =
    await supabase
      .from("lobby_players")
      .select(
        "*, profiles(display_name,balance,email)"
      )
      .eq(
        "lobby_id",
        currentLobby.id
      )
      .order("seat");

  if (playersResult.error) {
    console.error(
      "Refresh players error:",
      playersResult.error
    );

    return;
  }

  lobbyPlayers =
    playersResult.data || [];

  const starting =
    Number(
      currentLobby.starting_chips || 5000
    );

  for (const player of lobbyPlayers) {
    if (
      game.bankrolls[player.user_id] ===
      undefined
    ) {
      game.bankrolls[player.user_id] =
        starting;
    }
  }

  const title =
    byId("lobbyTitle");

  if (title) {
    title.textContent =
      currentLobby.name;
  }

  const code =
    byId("copyCodeBtn");

  if (code) {
    code.textContent =
      currentLobby.invite_code;
  }

  const count =
    byId("playerCount");

  if (count) {
    count.textContent =
      `${lobbyPlayers.length} / 7`;
  }

  const host =
    lobbyPlayers.find(function (player) {
      return (
        player.user_id ===
        currentLobby.host_id
      );
    });

  const hostLabel =
    byId("hostLabel");

  if (hostLabel) {
    hostLabel.textContent =
      `Host: ${
        host?.profiles?.display_name ||
        "—"
      }`;
  }

  myBet = Number(
    game?.bets?.[user.id] || 0
  );

  const currentBet =
    byId("currentBet");

  if (currentBet) {
    currentBet.textContent =
      myBet.toLocaleString();
  }

  renderTable();

  await loadChat();
}

/* =========================================================
   REALTIME
========================================================= */

function subscribeLobby() {
  if (!supabase || !currentLobby) {
    return;
  }

  if (lobbyChannel) {
    supabase.removeChannel(
      lobbyChannel
    );

    lobbyChannel = null;
  }

  lobbyChannel = supabase
    .channel(
      `lobby-${currentLobby.id}`
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobbies",
        filter:
          `id=eq.${currentLobby.id}`
      },
      function () {
        refreshLobby();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_players",
        filter:
          `lobby_id=eq.${currentLobby.id}`
      },
      function () {
        refreshLobby();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter:
          `lobby_id=eq.${currentLobby.id}`
      },
      function () {
        loadChat();
      }
    )
    .subscribe();
}

/* =========================================================
   CHAT
========================================================= */

async function loadChat() {
  if (!currentLobby || !supabase) {
    return;
  }

  const result = await supabase
    .from("chat_messages")
    .select("*")
    .eq(
      "lobby_id",
      currentLobby.id
    )
    .order("created_at", {
      ascending: true
    })
    .limit(80);

  if (result.error) {
    return;
  }

  const chatLog =
    byId("chatLog");

  if (!chatLog) {
    return;
  }

  chatLog.innerHTML =
    (result.data || [])
      .map(function (message) {
        return `
          <div class="chat-msg">
            <strong>
              ${escapeHtml(
                message.display_name
              )}
            </strong>
            ${escapeHtml(
              message.message
            )}
          </div>
        `;
      })
      .join("");

  chatLog.scrollTop =
    chatLog.scrollHeight;
}

async function sendChatMessage() {
  if (!currentLobby || !user) {
    return;
  }

  const input =
    byId("chatInput");

  if (!input) {
    return;
  }

  const message =
    input.value.trim();

  if (!message) {
    return;
  }

  const result =
    await supabase
      .from("chat_messages")
      .insert({
        lobby_id:
          currentLobby.id,
        user_id:
          user.id,
        display_name:
          profile?.display_name ||
          "Player",
        message: message
      });

  if (result.error) {
    toast(
      "Message failed: " +
      result.error.message
    );

    return;
  }

  input.value = "";

  await loadChat();
}

/* =========================================================
   CARD DISPLAY
========================================================= */

function cardHtml(card, back) {
  if (back) {
    return `
      <div class="card back">?</div>
    `;
  }

  const red =
    card.suit === "♥" ||
    card.suit === "♦";

  return `
    <div class="card ${red ? "red" : ""}">
      <span>${escapeHtml(
        card.rank
      )}</span>
      <span class="suit">
        ${escapeHtml(card.suit)}
      </span>
      <span>${escapeHtml(
        card.rank
      )}</span>
    </div>
  `;
}

/* =========================================================
   TABLE RENDERING
========================================================= */

function renderTable() {
  if (!currentLobby || !game) {
    return;
  }

  const dealerCards =
    byId("dealerCards");

  const dealer =
    game.dealer || [];

  const hideHole =
    game.phase === "playing" &&
    dealer.length > 1;

  if (dealerCards) {
    dealerCards.innerHTML =
      dealer
        .map(function (card, index) {
          return cardHtml(
            card,
            hideHole && index === 1
          );
        })
        .join("");
  }

  const dealerMeta =
    byId("dealerMeta");

  if (dealerMeta) {
    if (hideHole) {
      dealerMeta.textContent =
        "Hole card hidden";
    } else if (dealer.length) {
      dealerMeta.textContent =
        `Total ${
          handValue(dealer).total
        }`;
    } else {
      dealerMeta.textContent = "";
    }
  }

  const phase =
    game.phase || "waiting";

  const tableStatus =
    byId("tableStatus");

  if (tableStatus) {
    if (phase === "waiting") {
      tableStatus.textContent =
        "Set your bets, then the host deals.";
    } else if (phase === "playing") {
      if (
        game.turn_user_id ===
        user.id
      ) {
        tableStatus.textContent =
          "Your turn.";
      } else {
        tableStatus.textContent =
          `Waiting for ${
            playerName(
              game.turn_user_id
            )
          }…`;
      }
    } else if (phase === "dealer") {
      tableStatus.textContent =
        "Dealer is resolving the hand…";
    } else if (phase === "finished") {
      tableStatus.textContent =
        game.message ||
        "Round finished.";
    }
  }

  const playersZone =
    byId("playersZone");

  if (playersZone) {
    playersZone.innerHTML =
      lobbyPlayers
        .map(function (player) {
          const hand =
            game.hands?.[
              player.user_id
            ] || [];

          const value =
            handValue(hand);

          const isMe =
            player.user_id ===
            user.id;

          const bet =
            Number(
              game.bets?.[
                player.user_id
              ] || 0
            );

          const bankroll =
            Number(
              game.bankrolls?.[
                player.user_id
              ] || 0
            );

          const result =
            game.results?.[
              player.user_id
            ];

          const isHost =
            player.user_id ===
            currentLobby.host_id;

          return `
            <div class="seat ${
              isMe ? "me" : ""
            }">

              <div class="seat-name">
                ${escapeHtml(
                  player.profiles
                    ?.display_name ||
                  "Player"
                )}
              </div>

              ${
                isHost
                  ? `
                    <div class="seat-host">
                      HOST
                    </div>
                  `
                  : ""
              }

              <div class="seat-bet">
                <span class="status-dot"></span>
                Bet ${bet.toLocaleString()}
              </div>

              <div class="cards">
                ${hand
                  .map(function (card) {
                    return cardHtml(
                      card,
                      false
                    );
                  })
                  .join("")}
              </div>

              ${
                hand.length
                  ? `
                    <div class="hand-meta">
                      ${value.total}
                      ${
                        value.soft
                          ? " soft"
                          : ""
                      }
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
                      ${escapeHtml(
                        result
                      )}
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

  toggleElement(
    "playerActions",
    !myTurn
  );

  const dealerCanAct =
    game.phase === "dealer" &&
    currentLobby.host_id ===
      user.id;

  toggleElement(
    "dealerActionBtn",
    !dealerCanAct
  );

  const canStart =
    (
      game.phase === "waiting" ||
      game.phase === "finished"
    ) &&
    currentLobby.host_id ===
      user.id;

  toggleElement(
    "startRoundBtn",
    !canStart
  );

  const startButton =
    byId("startRoundBtn");

  if (startButton) {
    startButton.textContent =
      game.phase === "finished"
        ? "Start new round"
        : "Deal round";
  }

  const doubleButton =
    byId("doubleBtn");

  if (doubleButton) {
    doubleButton.disabled =
      !(
        myTurn &&
        myHand.length === 2 &&
        Number(
          game.bankrolls?.[
            user.id
          ] || 0
        ) >= myBet
      );
  }

  renderDealerBank();
}

/* =========================================================
   BETTING
========================================================= */

async function setBet(amount) {
  amount = Math.floor(
    Number(amount)
  );

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

  if (!currentLobby || !game) {
    return;
  }

  if (game.phase !== "waiting") {
    toast(
      "Bets can only be changed before a deal."
    );
    return;
  }

  const bankroll =
    Number(
      game.bankrolls?.[
        user.id
      ] || 0
    );

  if (amount > bankroll) {
    toast(
      "Not enough virtual chips."
    );
    return;
  }

  const nextGame =
    cloneGame();

  nextGame.bets = {
    ...(nextGame.bets || {}),
    [user.id]: amount
  };

  myBet = amount;

  await saveGame(nextGame);
}

/* =========================================================
   START / RESET ROUND
========================================================= */

async function startRound() {
  if (!currentLobby) {
    return;
  }

  if (
    currentLobby.host_id !==
    user.id
  ) {
    toast(
      "Only the host can deal."
    );
    return;
  }

  if (game.phase === "finished") {
    await resetRound();
    return;
  }

  const activePlayers =
    lobbyPlayers.filter(
      function (player) {
        return (
          Number(
            game?.bets?.[
              player.user_id
            ] || 0
          ) > 0
        );
      }
    );

  if (!activePlayers.length) {
    toast(
      "At least one player needs a bet."
    );
    return;
  }

  const shoe =
    makeShoe(6);

  const hands = {};
  const bets = {
    ...(game.bets || {})
  };

  const bankrolls = {
    ...(game.bankrolls || {})
  };

  const done = {};

  for (
    const player of activePlayers
  ) {
    const bet =
      Number(
        bets[player.user_id] || 0
      );

    if (
      bet <= 0 ||
      Number(
        bankrolls[player.user_id] || 0
      ) < bet
    ) {
      continue;
    }

    hands[player.user_id] = [
      shoe.pop(),
      shoe.pop()
    ];

    bankrolls[player.user_id] -=
      bet;

    done[player.user_id] =
      isBlackjack(
        hands[player.user_id]
      );
  }

  const dealer = [
    shoe.pop(),
    shoe.pop()
  ];

  const playingPlayers =
    activePlayers.filter(
      function (player) {
        return !!hands[
          player.user_id
        ];
      }
    );

  let firstTurn = null;

  for (
    const player of playingPlayers
  ) {
    if (
      !done[player.user_id]
    ) {
      firstTurn =
        player.user_id;
      break;
    }
  }

  const nextGame = {
    phase: firstTurn
      ? "playing"
      : "dealer",
    shoe: shoe,
    dealer: dealer,
    hands: hands,
    bets: bets,
    bankrolls: bankrolls,
    done: done,
    results: {},
    ledger: {
      ...(game.ledger || {})
    },
    turn_user_id: firstTurn,
    message: ""
  };

  await saveGame(nextGame);

  if (!firstTurn) {
    game = nextGame;
    await runDealer();
  }
}

async function resetRound() {
  if (!currentLobby) {
    return;
  }

  if (
    currentLobby.host_id !==
    user.id
  ) {
    toast(
      "Only the host can start a new round."
    );
    return;
  }

  const bankrolls = {
    ...(game?.bankrolls || {})
  };

  const nextGame = {
    phase: "waiting",
    shoe: [],
    dealer: [],
    hands: {},
    bets: {},
    bankrolls: bankrolls,
    done: {},
    results: {},
    ledger: {
      ...(game?.ledger || {})
    },
    turn_user_id: null,
    message: ""
  };

  await saveGame(nextGame);
}

/* =========================================================
   PLAYER ACTIONS
========================================================= */

async function playerAction(type) {
  if (
    !game ||
    game.phase !== "playing" ||
    game.turn_user_id !== user.id
  ) {
    return;
  }

  const nextGame =
    cloneGame();

  if (!nextGame.hands) {
    nextGame.hands = {};
  }

  if (!nextGame.bets) {
    nextGame.bets = {};
  }

  if (!nextGame.done) {
    nextGame.done = {};
  }

  const hand =
    nextGame.hands[user.id] || [];

  const bet =
    Number(
      nextGame.bets[user.id] || 0
    );

  if (!bet) {
    return;
  }

  if (type === "hit") {
    const card =
      nextGame.shoe.pop();

    nextGame.hands[user.id] = [
      ...hand,
      card
    ];

    const value =
      handValue(
        nextGame.hands[user.id]
      ).total;

    if (value >= 21) {
      nextGame.done[user.id] =
        true;

      nextGame.turn_user_id =
        nextTurn(
          nextGame,
          user.id
        );
    }
  }

  if (type === "stand") {
    nextGame.done[user.id] =
      true;

    nextGame.turn_user_id =
      nextTurn(
        nextGame,
        user.id
      );
  }

  if (type === "double") {
    const bankroll =
      Number(
        nextGame.bankrolls[
          user.id
        ] || 0
      );

    if (
      hand.length !== 2 ||
      bankroll < bet
    ) {
      toast(
        "Double unavailable."
      );
      return;
    }

    nextGame.bankrolls[
      user.id
    ] -= bet;

    nextGame.bets[
      user.id
    ] = bet * 2;

    nextGame.hands[
      user.id
    ] = [
      ...hand,
      nextGame.shoe.pop()
    ];

    nextGame.done[user.id] =
      true;

    nextGame.turn_user_id =
      nextTurn(
        nextGame,
        user.id
      );
  }

  if (!nextGame.turn_user_id) {
    nextGame.phase = "dealer";
  }

  await saveGame(nextGame);

  if (
    nextGame.phase === "dealer" &&
    currentLobby.host_id === user.id
  ) {
    game = nextGame;
    await runDealer();
  }
}

function nextTurn(nextGame, currentUserId) {
  const ids =
    lobbyPlayers
      .filter(
        function (player) {
          return (
            Number(
              nextGame.bets?.[
                player.user_id
              ] || 0
            ) > 0
          );
        }
      )
      .map(function (player) {
        return player.user_id;
      });

  const currentIndex =
    ids.indexOf(
      currentUserId
    );

  for (
    let index =
      currentIndex + 1;
    index < ids.length;
    index++
  ) {
    const id = ids[index];

    if (!nextGame.done?.[id]) {
      return id;
    }
  }

  return null;
}

/* =========================================================
   DEALER
========================================================= */

async function runDealer() {
  if (!currentLobby) {
    return;
  }

  if (
    currentLobby.host_id !==
    user.id
  ) {
    return;
  }

  if (
    !game ||
    game.phase !== "dealer"
  ) {
    return;
  }

  const nextGame =
    cloneGame();

  while (
    handValue(
      nextGame.dealer
    ).total < 17 &&
    nextGame.shoe.length
  ) {
    nextGame.dealer.push(
      nextGame.shoe.pop()
    );
  }

  const dealerValue =
    handValue(
      nextGame.dealer
    ).total;

  const results = {};

  for (
    const player of lobbyPlayers
  ) {
    const id =
      player.user_id;

    const bet =
      Number(
        nextGame.bets?.[id] || 0
      );

    const hand =
      nextGame.hands?.[id] || [];

    if (
      !bet ||
      !hand.length
    ) {
      continue;
    }

    const playerValue =
      handValue(hand).total;

    const playerBlackjack =
      isBlackjack(hand);

    const dealerBlackjack =
      isBlackjack(
        nextGame.dealer
      );

    let payout = 0;
    let result = "";

    if (playerValue > 21) {
      result =
        "Bust — lose";
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
      nextGame.bankrolls[id] =
        Number(
          nextGame.bankrolls[id] || 0
        ) + payout;
    }
  }

  nextGame.results =
    results;

  nextGame.phase =
    "finished";

  nextGame.turn_user_id =
    null;

  nextGame.message =
    `Dealer: ${dealerValue}. ` +
    "Start a new round when ready.";

  await saveGame(nextGame);
}

/* =========================================================
   SAVE GAME
========================================================= */

async function saveGame(nextGame) {
  if (!currentLobby || !supabase) {
    return false;
  }

  game = nextGame;

  let status = "waiting";

  if (
    game.phase === "playing" ||
    game.phase === "dealer"
  ) {
    status = "playing";
  }

  if (game.phase === "finished") {
    status = "finished";
  }

  const result =
    await supabase
      .from("lobbies")
      .update({
        game: game,
        status: status
      })
      .eq(
        "id",
        currentLobby.id
      );

  if (result.error) {
    console.error(
      "Game save error:",
      result.error
    );

    toast(
      "Game save failed: " +
      result.error.message
    );

    return false;
  }

  renderTable();

  return true;
}

/* =========================================================
   DEALER BANK / LEDGER
========================================================= */

function ledgerValue(userId) {
  return Number(
    game?.ledger?.[userId] || 0
  );
}

function renderDealerBank() {
  const panel =
    byId("dealerBankPanel");

  if (!panel) {
    return;
  }

  const isDealer =
    currentLobby?.host_id ===
    user?.id;

  panel.classList.toggle(
    "hidden",
    !isDealer
  );

  if (!isDealer) {
    return;
  }

  const select =
    byId("dealerPlayerSelect");

  if (!select) {
    return;
  }

  const previous =
    select.value;

  select.innerHTML =
    lobbyPlayers
      .filter(function (player) {
        return (
          player.user_id !==
          user.id
        );
      })
      .map(function (player) {
        return `
          <option value="${escapeHtml(
            player.user_id
          )}">
            ${escapeHtml(
              player.profiles
                ?.display_name ||
              "Player"
            )}
          </option>
        `;
      })
      .join("");

  const matchingOption =
    Array.from(
      select.options
    ).find(function (option) {
      return (
        option.value ===
        previous
      );
    });

  if (matchingOption) {
    select.value =
      previous;
  }

  const ledger =
    byId("dealerLedger");

  if (!ledger) {
    return;
  }

  const otherPlayers =
    lobbyPlayers.filter(
      function (player) {
        return (
          player.user_id !==
          user.id
        );
      }
    );

  if (!otherPlayers.length) {
    ledger.innerHTML =
      `
        <div class="muted small">
          No other players yet.
        </div>
      `;

    return;
  }

  ledger.innerHTML =
    otherPlayers
      .map(function (player) {
        const amount =
          ledgerValue(
            player.user_id
          );

        let text;

        if (amount > 0) {
          text =
            `+${amount.toLocaleString()} (dealer owes)`;
        } else if (amount < 0) {
          text =
            `-${Math.abs(
              amount
            ).toLocaleString()} (owes dealer)`;
        } else {
          text =
            "0 (settled)";
        }

        const className =
          amount > 0
            ? "up"
            : amount < 0
              ? "down"
              : "even";

        return `
          <div class="ledger-row">
            <span>
              ${escapeHtml(
                player.profiles
                  ?.display_name ||
                "Player"
              )}
            </span>

            <strong class="${className}">
              ${text}
            </strong>
          </div>
        `;
      })
      .join("");
}

async function dealerAdjust(direction) {
  if (
    !currentLobby ||
    currentLobby.host_id !==
      user.id
  ) {
    toast(
      "Only the dealer can change the ledger."
    );
    return;
  }

  const select =
    byId("dealerPlayerSelect");

  const amountInput =
    byId("dealerAmount");

  const target =
    select?.value;

  const amount =
    Math.floor(
      Number(
        amountInput?.value
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

  const nextGame =
    cloneGame();

  nextGame.ledger = {
    ...(nextGame.ledger || {})
  };

  const change =
    direction === "give"
      ? amount
      : -amount;

  nextGame.ledger[target] =
    Number(
      nextGame.ledger[target] || 0
    ) + change;

  await saveGame(nextGame);

  if (amountInput) {
    amountInput.value = "";
  }
}

/* =========================================================
   LEAVE LOBBY
========================================================= */

async function leaveLobby() {
  if (!currentLobby || !user) {
    return;
  }

  const result =
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

  if (result.error) {
    toast(
      "Could not leave table: " +
      result.error.message
    );

    return;
  }

  if (lobbyChannel) {
    await supabase.removeChannel(
      lobbyChannel
    );

    lobbyChannel = null;
  }

  currentLobby = null;
  lobbyPlayers = [];
  game = null;
  myBet = 0;

  showView("home");

  await loadLobbies();
}

/* =========================================================
   LOGOUT
========================================================= */

async function logout() {
  if (!supabase) {
    window.location.href =
      "index.html";

    return;
  }

  const result =
    await supabase.auth.signOut();

  if (result.error) {
    toast(
      "Logout failed: " +
      result.error.message
    );

    return;
  }

  window.location.href =
    "index.html";
}

/* =========================================================
   COPY INVITE CODE
========================================================= */

async function copyInviteCode() {
  if (!currentLobby) {
    return;
  }

  const code =
    currentLobby.invite_code;

  try {
    await navigator.clipboard.writeText(
      code
    );

    toast(
      "Invite code copied."
    );
  } catch (error) {
    toast(
      `Invite code: ${code}`
    );
  }
}

/* =========================================================
   BUTTON EVENT HANDLING
========================================================= */

/*
   IMPORTANT:
   We use one document-level click handler.
   This means buttons continue working even if
   the lobby list or other HTML is re-rendered.
*/

function initializeButtons() {
  console.log(
    "Blackjack Friends: button system loaded"
  );

  document.addEventListener(
    "click",
    async function (event) {
      const target =
        event.target.closest(
          "button"
        );

      if (!target) {
        return;
      }

      /* New Table */
      if (
        target.id ===
        "createLobbyBtn"
      ) {
        event.preventDefault();
        openCreateLobby();
        return;
      }

      /* Confirm Create */
      if (
        target.id ===
        "confirmCreateLobby"
      ) {
        event.preventDefault();
        await createLobby();
        return;
      }

      /* Profile */
      if (
        target.id ===
        "profileBtn"
      ) {
        event.preventDefault();
        openModal("profileModal");
        return;
      }

      /* Logout */
      if (
        target.id ===
        "logoutBtn"
      ) {
        event.preventDefault();
        await logout();
        return;
      }

      /* Back Home */
      if (
        target.id ===
        "backHomeBtn"
      ) {
        event.preventDefault();

        if (lobbyChannel) {
          await supabase.removeChannel(
            lobbyChannel
          );

          lobbyChannel = null;
        }

        currentLobby = null;
        lobbyPlayers = [];
        game = null;
        myBet = 0;

        showView("home");

        await loadLobbies();

        return;
      }

      /* Copy Code */
      if (
        target.id ===
        "copyCodeBtn"
      ) {
        event.preventDefault();
        await copyInviteCode();
        return;
      }

      /* Start / New Round */
      if (
        target.id ===
        "startRoundBtn"
      ) {
        event.preventDefault();
        await startRound();
        return;
      }

      /* Hit */
      if (
        target.id ===
        "hitBtn"
      ) {
        event.preventDefault();
        await playerAction("hit");
        return;
      }

      /* Stand */
      if (
        target.id ===
        "standBtn"
      ) {
        event.preventDefault();
        await playerAction("stand");
        return;
      }

      /* Double */
      if (
        target.id ===
        "doubleBtn"
      ) {
        event.preventDefault();
        await playerAction("double");
        return;
      }

      /* Dealer Action */
      if (
        target.id ===
        "dealerActionBtn"
      ) {
        event.preventDefault();
        await runDealer();
        return;
      }

      /* Dealer Give */
      if (
        target.id ===
        "dealerGiveBtn"
      ) {
        event.preventDefault();
        await dealerAdjust("give");
        return;
      }

      /* Dealer Take */
      if (
        target.id ===
        "dealerTakeBtn"
      ) {
        event.preventDefault();
        await dealerAdjust("take");
        return;
      }

      /* Leave */
      if (
        target.id ===
        "leaveLobbyBtn"
      ) {
        event.preventDefault();
        await leaveLobby();
        return;
      }

      /* Custom Bet */
      if (
        target.id ===
        "setBetBtn"
      ) {
        event.preventDefault();

        const amount =
          Number(
            byId("customBet")
              ?.value
          );

        await setBet(amount);
        return;
      }

      /* Chip buttons */
      if (
        target.classList.contains(
          "chip-btn"
        )
      ) {
        event.preventDefault();

        const amount =
          Number(
            target.dataset.bet
          );

        await setBet(amount);
        return;
      }

      /* Join Table */
      if (
        target.classList.contains(
          "join-btn"
        )
      ) {
        event.preventDefault();

        const lobbyId =
          target.dataset.lobbyId;

        if (lobbyId) {
          await joinLobby(
            lobbyId
          );
        }

        return;
      }

      /* Close modal */
      const closeTarget =
        target.dataset.close;

      if (closeTarget) {
        event.preventDefault();
        closeModal(closeTarget);
      }
    }
  );

  /* Chat */
  const chatForm =
    byId("chatForm");

  if (chatForm) {
    chatForm.addEventListener(
      "submit",
      async function (event) {
        event.preventDefault();
        await sendChatMessage();
      }
    );
  }

  console.log(
    "Blackjack Friends: button handlers connected"
  );
}

/* =========================================================
   BOOT
========================================================= */

async function boot() {
  try {
    console.log(
      "Blackjack Friends: booting..."
    );

    if (
      !APP_CONFIG.SUPABASE_URL ||
      !APP_CONFIG.SUPABASE_ANON_KEY
    ) {
      console.error(
        "Supabase configuration is missing."
      );

      toast(
        "Supabase configuration is missing."
      );

      return;
    }

    if (
      !window.supabase ||
      !window.supabase.createClient
    ) {
      console.error(
        "Supabase library did not load."
      );

      toast(
        "Supabase library did not load."
      );

      return;
    }

    supabase =
      window.supabase.createClient(
        APP_CONFIG.SUPABASE_URL,
        APP_CONFIG.SUPABASE_ANON_KEY
      );

    console.log(
      "Blackjack Friends: Supabase connected"
    );

    const sessionResult =
      await supabase.auth.getSession();

    if (sessionResult.error) {
      console.error(
        "Session error:",
        sessionResult.error
      );

      toast(
        sessionResult.error.message
      );

      return;
    }

    if (
      !sessionResult.data.session
    ) {
      window.location.href =
        "index.html";

      return;
    }

    user =
      sessionResult.data.session.user;

    console.log(
      "Logged in as:",
      user.email
    );

    const profileLoaded =
      await loadProfile();

    if (!profileLoaded) {
      return;
    }

    renderProfile();

    showView("home");

    await loadLobbies();

    console.log(
      "Blackjack Friends: ready"
    );

  } catch (error) {
    console.error(
      "Blackjack Friends boot error:",
      error
    );

    toast(
      "Game error: " +
      (
        error?.message ||
        String(error)
      )
    );
  }
}

/* =========================================================
   START
========================================================= */

function startApplication() {
  console.log(
    "Blackjack Friends: app.js loaded"
  );

  initializeButtons();
  boot();
}

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    startApplication,
    {
      once: true
    }
  );
} else {
  startApplication();
}
