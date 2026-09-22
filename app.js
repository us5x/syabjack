const { createClient } = window.supabase;

const cfg = window.APP_CONFIG || {};

const supabase = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY
);

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
const ranks = [
  "A", "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "J", "Q", "K"
];


/* =========================================================
   BASIC HELPERS
========================================================= */

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
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );
}


function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [array[i], array[j]] =
      [array[j], array[i]];
  }

  return array;
}


function currentGame() {
  return JSON.parse(
    JSON.stringify(game || {})
  );
}


/* =========================================================
   CARDS
========================================================= */

function makeShoe(decks = 6) {
  const shoe = [];

  for (let deck = 0; deck < decks; deck++) {
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


function handValue(cards = []) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {

    if (card.rank === "A") {
      aces++;
      total += 11;

    } else if (
      ["K", "Q", "J"].includes(card.rank)
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


function isBlackjack(cards) {
  return (
    cards.length === 2 &&
    handValue(cards).total === 21
  );
}


function cardHtml(card, back = false) {

  if (back) {
    return `<div class="card back">?</div>`;
  }

  const red =
    card.suit === "♥" ||
    card.suit === "♦";

  return `
    <div class="card ${red ? "red" : ""}">
      <span>${esc(card.rank)}</span>
      <span class="suit">${esc(card.suit)}</span>
      <span>${esc(card.rank)}</span>
    </div>
  `;
}


/* =========================================================
   AUTH / SESSION
========================================================= */

async function getProfile() {

  if (!user) {
    return false;
  }

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Profile error:", error);

    toast(
      "Logged in, but your player profile could not be loaded: " +
      error.message
    );

    return false;
  }

  profile = data;

  renderBalance();

  return true;
}


function renderBalance() {

  if ($("#topBalance")) {
    $("#topBalance").textContent =
      Number(profile?.balance || 0)
        .toLocaleString();
  }

  if ($("#profileBalance")) {
    $("#profileBalance").textContent =
      Number(profile?.balance || 0)
        .toLocaleString();
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


async function startApplication() {

  const isGamePage =
    location.pathname
      .split("/")
      .pop()
      .toLowerCase() === "game.html";


  /*
    Get the saved Supabase session.

    Supabase automatically stores the session
    in browser storage. We never store the password.
  */

  const {
    data,
    error
  } = await supabase.auth.getSession();


  if (error) {

    console.error(
      "Session error:",
      error
    );

    if (isGamePage) {
      location.replace("index.html");
    }

    return;
  }


  /*
    NOT LOGGED IN
  */

  if (!data.session) {

    if (isGamePage) {
      location.replace("index.html");
    }

    return;
  }


  /*
    LOGGED IN
  */

  user = data.session.user;


  /*
    If someone is already logged in and
    visits index.html, send them directly
    to the game.
  */

  if (!isGamePage) {

    location.replace("game.html");

    return;
  }


  /*
    We are on game.html and have a session.
  */

  const profileLoaded =
    await getProfile();

  if (!profileLoaded) {
    return;
  }


  initializeGamePage();


  await loadLobbies();


  /*
    Keep login/logout state synchronized.
  */

  supabase.auth.onAuthStateChange(
    (event, session) => {

      if (!session) {

        user = null;
        profile = null;

        location.replace("index.html");

        return;
      }

      user = session.user;

    }
  );
}


/* =========================================================
   GAME PAGE INITIALIZATION
========================================================= */

function initializeGamePage() {

  console.log("Blackjack Friends game initialized.");

  /*
    HOME
  */

  const createLobbyBtn =
    $("#createLobbyBtn");

  if (createLobbyBtn) {
    createLobbyBtn.addEventListener(
      "click",
      () => {

        const modal =
          $("#createModal");

        if (modal) {
          modal.classList.remove("hidden");
        }

      }
    );
  }


  /*
    CREATE LOBBY
  */

  const confirmCreateLobby =
    $("#confirmCreateLobby");

  if (confirmCreateLobby) {

    confirmCreateLobby.addEventListener(
      "click",
      createLobby
    );

  }


  /*
    BACK HOME
  */

  const backHomeBtn =
    $("#backHomeBtn");

  if (backHomeBtn) {

    backHomeBtn.addEventListener(
      "click",
      async () => {

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

        show("home");

        await loadLobbies();

      }
    );

  }


  /*
    PROFILE
  */

  const profileBtn =
    $("#profileBtn");

  if (profileBtn) {

    profileBtn.addEventListener(
      "click",
      () => {

        $("#profileModal")
          ?.classList.remove("hidden");

      }
    );

  }


  /*
    MODAL CLOSE BUTTONS
  */

  $$("[data-close]").forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          const target =
            $("#" + button.dataset.close);

          target?.classList.add("hidden");

        }
      );

    }
  );


  /*
    LOGOUT
  */

  const logoutBtn =
    $("#logoutBtn");

  if (logoutBtn) {

    logoutBtn.addEventListener(
      "click",
      async () => {

        logoutBtn.disabled = true;
        logoutBtn.textContent = "Logging out…";

        await supabase.auth.signOut();

        location.replace("index.html");

      }
    );

  }


  /*
    COPY INVITE CODE
  */

  const copyCodeBtn =
    $("#copyCodeBtn");

  if (copyCodeBtn) {

    copyCodeBtn.addEventListener(
      "click",
      async () => {

        if (!currentLobby) {
          return;
        }

        const code =
          currentLobby.invite_code;

        try {

          await navigator.clipboard.writeText(
            code
          );

          toast("Invite code copied.");

        } catch {

          toast(
            "Invite code: " + code
          );

        }

      }
    );

  }


  /*
    BET BUTTONS
  */

  $$(".chip-btn").forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          setBet(
            Number(button.dataset.bet)
          );

        }
      );

    }
  );


  /*
    CUSTOM BET
  */

  const setBetBtn =
    $("#setBetBtn");

  if (setBetBtn) {

    setBetBtn.addEventListener(
      "click",
      () => {

        setBet(
          Number(
            $("#customBet")?.value
          )
        );

      }
    );

  }


  /*
    DEAL ROUND
  */

  const startRoundBtn =
    $("#startRoundBtn");

  if (startRoundBtn) {

    startRoundBtn.addEventListener(
      "click",
      async () => {

        if (game?.phase === "finished") {
          await resetRound();
        } else {
          await startRound();
        }

      }
    );

  }


  /*
    HIT
  */

  const hitBtn =
    $("#hitBtn");

  if (hitBtn) {

    hitBtn.addEventListener(
      "click",
      () => playerAction("hit")
    );

  }


  /*
    STAND
  */

  const standBtn =
    $("#standBtn");

  if (standBtn) {

    standBtn.addEventListener(
      "click",
      () => playerAction("stand")
    );

  }


  /*
    DOUBLE
  */

  const doubleBtn =
    $("#doubleBtn");

  if (doubleBtn) {

    doubleBtn.addEventListener(
      "click",
      () => playerAction("double")
    );

  }


  /*
    DEALER
  */

  const dealerActionBtn =
    $("#dealerActionBtn");

  if (dealerActionBtn) {

    dealerActionBtn.addEventListener(
      "click",
      runDealer
    );

  }


  /*
    DEALER BANK
  */

  const dealerGiveBtn =
    $("#dealerGiveBtn");

  if (dealerGiveBtn) {

    dealerGiveBtn.addEventListener(
      "click",
      () => dealerAdjust("give")
    );

  }


  const dealerTakeBtn =
    $("#dealerTakeBtn");

  if (dealerTakeBtn) {

    dealerTakeBtn.addEventListener(
      "click",
      () => dealerAdjust("take")
    );

  }


  /*
    LEAVE TABLE
  */

  const leaveLobbyBtn =
    $("#leaveLobbyBtn");

  if (leaveLobbyBtn) {

    leaveLobbyBtn.addEventListener(
      "click",
      leaveLobby
    );

  }


  /*
    CHAT
  */

  const chatForm =
    $("#chatForm");

  if (chatForm) {

    chatForm.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();

        const input =
          $("#chatInput");

        const message =
          input?.value.trim();

        if (!message || !currentLobby) {
          return;
        }

        const { error } =
          await supabase
            .from("chat_messages")
            .insert({
              lobby_id: currentLobby.id,
              user_id: user.id,
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

      }
    );

  }

}


/* =========================================================
   HOME / LOBBIES
========================================================= */

function show(view) {

  if ($("#homeView")) {
    $("#homeView")
      .classList.toggle(
        "hidden",
        view !== "home"
      );
  }

  if ($("#lobbyView")) {
    $("#lobbyView")
      .classList.toggle(
        "hidden",
        view !== "lobby"
      );
  }
}


async function loadLobbies() {

  const {
    data,
    error
  } = await supabase
    .from("lobbies")
    .select("*")
    .order("created_at", {
      ascending: false
    });


  if (error) {

    console.error(
      "Lobby loading error:",
      error
    );

    toast(error.message);

    return;
  }


  renderLobbies(data || []);
}


function renderLobbies(rows) {

  const list =
    $("#lobbyList");

  const empty =
    $("#emptyLobbies");


  if (!list || !empty) {
    return;
  }


  if (!rows.length) {

    list.innerHTML = "";

    empty.classList.remove(
      "hidden"
    );

    return;
  }


  empty.classList.add(
    "hidden"
  );


  list.innerHTML =
    rows.map((lobby) => `

      <div class="lobby-card">

        <div class="eyebrow">
          PRIVATE TABLE
        </div>

        <h4>
          ${esc(lobby.name)}
        </h4>

        <div class="lobby-meta">

          <span>
            ♟ Private
          </span>

          <span>
            🪙 ${Number(
              lobby.starting_chips || 0
            ).toLocaleString()}
          </span>

          <span>
            ${esc(lobby.status || "waiting")}
          </span>

        </div>

        <button
          type="button"
          class="secondary join-btn"
          data-id="${esc(lobby.id)}"
        >
          Join table
        </button>

      </div>

    `).join("");


  $$(".join-btn").forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          joinLobby(
            button.dataset.id
          );

        }
      );

    }
  );

}


/* =========================================================
   CREATE / JOIN LOBBY
========================================================= */

async function createLobby() {

  if (!user) {
    toast("You are not logged in.");
    return;
  }


  const name =
    $("#newLobbyName")
      ?.value.trim() ||
    "Friends Table";


  const starting =
    Number(
      $("#newStartingChips")
        ?.value
    ) || 5000;


  const code =
    Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();


  const {
    data,
    error
  } = await supabase
    .from("lobbies")
    .insert({
      name,
      invite_code: code,
      host_id: user.id,
      starting_chips: starting,
      game: {
        phase: "waiting",
        ledger: {}
      }
    })
    .select()
    .single();


  if (error) {

    toast(error.message);

    return;
  }


  const {
    error: playerError
  } = await supabase
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


  $("#createModal")
    ?.classList.add("hidden");


  await joinLobby(data.id);
}


async function joinLobby(id) {

  const {
    data: lobby,
    error
  } = await supabase
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
    .select(
      "*, profiles(display_name,balance,email)"
    )
    .eq("lobby_id", id)
    .order("seat");


  if (playerError) {

    toast(playerError.message);

    return;
  }


  const playerList =
    players || [];


  /*
    Add ourselves if we're not
    already sitting at the table.
  */

  if (
    !playerList.some(
      p => p.user_id === user.id
    )
  ) {

    const usedSeats =
      new Set(
        playerList.map(
          p => p.seat
        )
      );


    let seat = 1;

    while (usedSeats.has(seat)) {
      seat++;
    }


    if (seat > 7) {

      toast(
        "This table is full."
      );

      return;
    }


    const {
      error: joinError
    } = await supabase
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

  game =
    lobby.game || {
      phase: "waiting",
      ledger: {}
    };


  await refreshLobby();

  subscribeLobby();

  show("lobby");
}


/* =========================================================
   REFRESH LOBBY
========================================================= */

async function refreshLobby() {

  if (!currentLobby) {
    return;
  }


  const {
    data: lobby,
    error
  } = await supabase
    .from("lobbies")
    .select("*")
    .eq("id", currentLobby.id)
    .single();


  if (error) {

    console.error(
      "Refresh lobby error:",
      error
    );

    return;
  }


  currentLobby = lobby;


  game =
    lobby.game || {
      phase: "waiting",
      ledger: {}
    };


  const {
    data: players,
    error: playerError
  } = await supabase
    .from("lobby_players")
    .select(
      "*, profiles(display_name,balance,email)"
    )
    .eq("lobby_id", currentLobby.id)
    .order("seat");


  if (playerError) {

    toast(playerError.message);

    return;
  }


  lobbyPlayers =
    players || [];


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


  const host =
    lobbyPlayers.find(
      p =>
        p.user_id ===
        currentLobby.host_id
    );


  if ($("#hostLabel")) {
    $("#hostLabel").textContent =
      `Host: ${
        host?.profiles?.display_name ||
        "—"
      }`;
  }


  myBet =
    Number(
      game?.bets?.[user.id] || 0
    );


  if ($("#currentBet")) {
    $("#currentBet").textContent =
      myBet.toLocaleString();
  }


  renderTable();

  await loadChat();
}


/* =========================================================
   REALTIME
========================================================= */

function subscribeLobby() {

  if (!currentLobby) {
    return;
  }


  if (lobbyChannel) {

    supabase.removeChannel(
      lobbyChannel
    );

  }


  lobbyChannel =
    supabase
      .channel(
        "lobby-" +
        currentLobby.id
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
        () => refreshLobby()
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
        () => refreshLobby()
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
        () => loadChat()
      )

      .subscribe();
}


/* =========================================================
   CHAT
========================================================= */

async function loadChat() {

  if (
    !currentLobby ||
    !$("#chatLog")
  ) {
    return;
  }


  const {
    data,
    error
  } = await supabase
    .from("chat_messages")
    .select("*")
    .eq(
      "lobby_id",
      currentLobby.id
    )
    .order(
      "created_at",
      { ascending: true }
    )
    .limit(80);


  if (error) {

    console.error(
      "Chat error:",
      error
    );

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


  $("#chatLog").scrollTop =
    $("#chatLog").scrollHeight;
}


/* =========================================================
   TABLE RENDERING
========================================================= */

function nameOf(id) {

  return (
    lobbyPlayers.find(
      p => p.user_id === id
    )?.profiles?.display_name ||
    "player"
  );

}


function renderTable() {

  if (
    !currentLobby ||
    !game
  ) {
    return;
  }


  const dealer =
    game.dealer || [];


  const hideHole =
    game.phase === "playing" &&
    dealer.length > 1;


  if ($("#dealerCards")) {

    $("#dealerCards").innerHTML =
      dealer
        .map(
          (card, index) =>
            cardHtml(
              card,
              hideHole && index === 1
            )
        )
        .join("");

  }


  const dealerValue =
    !hideHole && dealer.length
      ? handValue(dealer).total
      : "";


  if ($("#dealerMeta")) {

    $("#dealerMeta").textContent =
      hideHole
        ? "Hole card hidden"
        : dealer.length
          ? `Total ${dealerValue}`
          : "";

  }


  const phase =
    game.phase || "waiting";


  if ($("#tableStatus")) {

    if (phase === "waiting") {

      $("#tableStatus").textContent =
        "Set your bets, then the host deals.";

    } else if (phase === "playing") {

      $("#tableStatus").textContent =
        game.turn_user_id === user.id
          ? "Your turn."
          : `Waiting for ${nameOf(
              game.turn_user_id
            )}…`;

    } else if (phase === "dealer") {

      $("#tableStatus").textContent =
        "Dealer is resolving the hand…";

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

          const hand =
            game.hands?.[player.user_id] ||
            [];

          const value =
            handValue(hand);

          const isMe =
            player.user_id === user.id;

          const bet =
            Number(
              game.bets?.[player.user_id] ||
              0
            );

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
                player.user_id ===
                currentLobby.host_id
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
                      ${value.total}${value.soft ? " soft" : ""}
                    </div>
                  `
                  : ""
              }

              ${
                result
                  ? `
                    <div class="seat-result">
                      ${esc(result)}
                    </div>
                  `
                  : ""
              }

              <div class="seat-ledger">
                ${ledgerLabel(
                  player.user_id
                )}
              </div>

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


  if ($("#startRoundBtn")) {

    $("#startRoundBtn")
      .classList.toggle(
        "hidden",
        !(
          game.phase === "waiting" &&
          currentLobby.host_id === user.id
        )
      );

    $("#startRoundBtn").textContent =
      "Deal round";

  }


  if ($("#doubleBtn")) {

    $("#doubleBtn").disabled =
      !(
        myHand.length === 2 &&
        Number(profile?.balance || 0) >= myBet
      );

  }


  renderDealerBank();
}


/* =========================================================
   DEALER BANK
========================================================= */

function ledgerValue(id) {

  return Number(
    game?.ledger?.[id] || 0
  );

}


function ledgerLabel(id) {

  const amount =
    ledgerValue(id);


  if (amount > 0) {

    return `
      <span class="up">
        Dealer owes ${amount.toLocaleString()}
      </span>
    `;

  }


  if (amount < 0) {

    return `
      <span class="down">
        Owes dealer ${Math.abs(
          amount
        ).toLocaleString()}
      </span>
    `;

  }


  return `
    <span>
      Settled
    </span>
  `;
}


function renderDealerBank() {

  const panel =
    $("#dealerBankPanel");


  if (!panel || !currentLobby) {
    return;
  }


  const isDealer =
    currentLobby.host_id === user.id;


  panel.classList.toggle(
    "hidden",
    !isDealer
  );


  if (!isDealer) {
    return;
  }


  const select =
    $("#dealerPlayerSelect");


  if (!select) {
    return;
  }


  const current =
    select.value;


  select.innerHTML =
    lobbyPlayers
      .filter(
        p =>
          p.user_id !== user.id
      )
      .map(
        p => `
          <option value="${p.user_id}">
            ${esc(
              p.profiles?.display_name ||
              "Player"
            )}
          </option>
        `
      )
      .join("");


  if (
    [...select.options].some(
      option =>
        option.value === current
    )
  ) {

    select.value = current;

  }


  const ledger =
    $("#dealerLedger");


  if (!ledger) {
    return;
  }


  ledger.innerHTML =
    lobbyPlayers
      .filter(
        p =>
          p.user_id !== user.id
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
              ? `-${Math.abs(
                  amount
                ).toLocaleString()} (owes dealer)`
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
      .join("")
      ||
      `
        <div class="muted small">
          No other players yet.
        </div>
      `;
}


async function dealerAdjust(direction) {

  if (
    !currentLobby ||
    currentLobby.host_id !== user.id
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


  const next =
    currentGame();


  next.ledger = {
    ...(next.ledger || {})
  };


  next.ledger[target] =
    Number(
      next.ledger[target] || 0
    ) +
    (
      direction === "give"
        ? amount
        : -amount
    );


  await saveGame(next);


  if ($("#dealerAmount")) {
    $("#dealerAmount").value = "";
  }

}


/* =========================================================
   SAVE GAME
========================================================= */

async function saveGame(next) {

  game = next;


  const {
    error
  } = await supabase
    .from("lobbies")
    .update({
      game,
      status:
        game.phase === "waiting"
          ? "waiting"
          : game.phase === "finished"
            ? "finished"
            : "playing"
    })
    .eq(
      "id",
      currentLobby.id
    );


  if (error) {

    console.error(
      "Save game error:",
      error
    );

    toast(error.message);

    return false;
  }


  renderTable();

  return true;
}


/* =========================================================
   BETTING
========================================================= */

async function setBet(amount) {

  amount =
    Math.floor(
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


  if (
    amount >
    Number(profile?.balance || 0)
  ) {

    toast(
      "Not enough virtual chips."
    );

    return;
  }


  if (
    game?.phase !== "waiting"
  ) {

    toast(
      "Bets can only be changed before a deal."
    );

    return;
  }


  const next =
    currentGame();


  next.bets = {
    ...(next.bets || {}),
    [user.id]: amount
  };


  myBet = amount;


  await saveGame(next);
}


/* =========================================================
   START ROUND
========================================================= */

async function startRound() {

  if (
    !currentLobby ||
    currentLobby.host_id !== user.id
  ) {

    toast(
      "Only the host can deal."
    );

    return;
  }


  const activePlayers =
    lobbyPlayers.filter(
      player =>
        Number(
          game?.bets?.[player.user_id] || 0
        ) > 0
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
    ...(game?.bets || {})
  };


  for (const player of activePlayers) {

    hands[player.user_id] = [
      shoe.pop(),
      shoe.pop()
    ];

  }


  const dealer = [
    shoe.pop(),
    shoe.pop()
  ];


  const next = {

    phase: "playing",

    shoe,

    dealer,

    hands,

    bets,

    results: {},

    ledger: {
      ...(game?.ledger || {})
    },

    turn_user_id:
      activePlayers[0].user_id,

    message: ""

  };


  /*
    Deduct the bets.

    This keeps your existing play-money
    system intact for now.
  */

  for (const player of activePlayers) {

    const bet =
      Number(
        bets[player.user_id] || 0
      );


    if (!bet) {
      continue;
    }


    const oldBalance =
      Number(
        player.profiles?.balance || 0
      );


    const {
      error
    } = await supabase
      .from("profiles")
      .update({
        balance:
          Math.max(
            0,
            oldBalance - bet
          )
      })
      .eq(
        "id",
        player.user_id
      );


    if (error) {

      console.error(
        "Bet deduction error:",
        error
      );

    }

  }


  await saveGame(next);

  await getProfile();

  await refreshLobby();
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


  const next =
    currentGame();


  const hand =
    next.hands[user.id] || [];


  const bet =
    Number(
      next.bets[user.id] || 0
    );


  if (type === "hit") {

    const card =
      next.shoe.pop();


    if (!card) {

      toast(
        "The shoe is empty."
      );

      return;
    }


    next.hands[user.id] = [
      ...hand,
      card
    ];


    const value =
      handValue(
        next.hands[user.id]
      );


    if (value.total >= 21) {

      next.turn_user_id =
        nextTurn(
          next,
          user.id
        );

    }

  }


  else if (type === "stand") {

    next.turn_user_id =
      nextTurn(
        next,
        user.id
      );

  }


  else if (type === "double") {

    if (
      hand.length !== 2 ||
      Number(profile?.balance || 0) < bet
    ) {

      toast(
        "Double unavailable."
      );

      return;
    }


    const card =
      next.shoe.pop();


    if (!card) {

      toast(
        "The shoe is empty."
      );

      return;
    }


    const {
      error
    } = await supabase
      .from("profiles")
      .update({
        balance:
          Number(profile.balance) - bet
      })
      .eq(
        "id",
        user.id
      );


    if (error) {

      toast(
        "Could not place the double bet: " +
        error.message
      );

      return;
    }


    next.bets[user.id] =
      bet * 2;


    next.hands[user.id] = [
      ...hand,
      card
    ];


    next.turn_user_id =
      nextTurn(
        next,
        user.id
      );


    await getProfile();

  }


  if (!next.turn_user_id) {

    next.phase = "dealer";

  }


  await saveGame(next);
}


function nextTurn(next, currentUserId) {

  const ids =
    lobbyPlayers
      .filter(
        player =>
          Number(
            next.bets?.[player.user_id] || 0
          ) > 0
      )
      .map(
        player =>
          player.user_id
      );


  const currentIndex =
    ids.indexOf(
      currentUserId
    );


  for (
    let i = currentIndex + 1;
    i < ids.length;
    i++
  ) {

    const hand =
      next.hands[ids[i]] || [];


    if (
      handValue(hand).total < 21
    ) {

      return ids[i];

    }

  }


  return null;
}


/* =========================================================
   DEALER
========================================================= */

async function runDealer() {

  if (
    !currentLobby ||
    currentLobby.host_id !== user.id ||
    game?.phase !== "dealer"
  ) {

    return;
  }


  const next =
    currentGame();


  while (
    handValue(next.dealer).total < 17
  ) {

    const card =
      next.shoe.pop();


    if (!card) {
      break;
    }


    next.dealer.push(card);

  }


  const dealerTotal =
    handValue(
      next.dealer
    ).total;


  const results = {};


  for (
    const player of lobbyPlayers
  ) {

    const id =
      player.user_id;


    const bet =
      Number(
        next.bets?.[id] || 0
      );


    const hand =
      next.hands?.[id] || [];


    if (!bet) {
      continue;
    }


    const playerTotal =
      handValue(hand).total;


    let payout = 0;
    let result = "";


    if (playerTotal > 21) {

      result =
        "Bust — lose";


    } else if (
      isBlackjack(hand) &&
      !isBlackjack(next.dealer)
    ) {

      result =
        "Blackjack — 3:2";

      payout =
        Math.floor(
          bet * 2.5
        );


    } else if (
      isBlackjack(hand) &&
      isBlackjack(next.dealer)
    ) {

      result =
        "Push";

      payout = bet;


    } else if (
      dealerTotal > 21 ||
      playerTotal > dealerTotal
    ) {

      result =
        "Win";

      payout =
        bet * 2;


    } else if (
      playerTotal === dealerTotal
    ) {

      result =
        "Push";

      payout = bet;


    } else {

      result =
        "Dealer wins";

    }


    results[id] = result;


    /*
      Preserve the existing balance behavior.
    */

    if (payout > 0) {

      const oldBalance =
        Number(
          player.profiles?.balance || 0
        );


      const {
        error
      } = await supabase
        .from("profiles")
        .update({
          balance:
            oldBalance + payout
        })
        .eq(
          "id",
          id
        );


      if (error) {

        console.error(
          "Payout error:",
          error
        );

      }

    }

  }


  next.results =
    results;

  next.phase =
    "finished";

  next.message =
    `Dealer: ${dealerTotal}. Start a new round when ready.`;

  next.turn_user_id =
    null;


  await saveGame(next);

  await getProfile();

  await refreshLobby();
}


/* =========================================================
   RESET
========================================================= */

async function resetRound() {

  if (
    !currentLobby ||
    currentLobby.host_id !== user.id
  ) {

    return;
  }


  const next = {

    phase: "waiting",

    shoe: [],

    dealer: [],

    hands: {},

    bets: {},

    results: {},

    ledger: {
      ...(game?.ledger || {})
    },

    turn_user_id: null,

    message: ""

  };


  await saveGame(next);

  await getProfile();

  await refreshLobby();
}


/* =========================================================
   LEAVE
========================================================= */

async function leaveLobby() {

  if (!currentLobby) {
    return;
  }


  const {
    error
  } = await supabase
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


  if (error) {

    toast(error.message);

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


  show("home");

  await loadLobbies();
}


/* =========================================================
   START
========================================================= */

startApplication();
