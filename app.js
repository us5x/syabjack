const { createClient } = window.supabase;
const cfg = window.APP_CONFIG || {};
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let user = null;
let profile = null;
let authMode = "login";
let currentLobby = null;
let lobbyPlayers = [];
let lobbyChannel = null;
let game = null;
let myBet = 0;
let chatChannel = null;

const suits = ["♠","♥","♦","♣"];
const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function toast(msg){
  const el=$("#toast");
  if (!el) return;
  el.textContent=msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>el.classList.remove("show"),2400);
}

function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function uid(){
  return crypto.randomUUID();
}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function makeShoe(decks=6){
  const shoe=[];
  for(let d=0;d<decks;d++)
    for(const suit of suits)
      for(const rank of ranks)
        shoe.push({rank,suit});
  return shuffle(shoe);
}

function handValue(cards=[]){
  let total=0, aces=0;

  for(const c of cards){
    if(c.rank==="A"){
      aces++;
      total+=11;
    }else if(["K","Q","J"].includes(c.rank)){
      total+=10;
    }else{
      total+=+c.rank;
    }
  }

  while(total>21 && aces){
    total-=10;
    aces--;
  }

  return {total,soft:aces>0};
}

function isBlackjack(cards){
  return cards.length===2 && handValue(cards).total===21;
}

async function getProfile(){
  if(!user) return false;

  const {data,error}=await supabase
    .from("profiles")
    .select("*")
    .eq("id",user.id)
    .single();

  if(error){
    toast(error.message);
    return false;
  }

  profile=data;
  renderBalance();
  return true;
}

function renderBalance(){
  if($("#topBalance"))
    $("#topBalance").textContent=(profile?.balance||0).toLocaleString();

  if($("#profileBalance"))
    $("#profileBalance").textContent=(profile?.balance||0).toLocaleString();

  if($("#profileName"))
    $("#profileName").textContent=profile?.display_name||"Player";

  if($("#profileEmail"))
    $("#profileEmail").textContent=profile?.email||"";
}

function show(view){
  if($("#homeView"))
    $("#homeView").classList.toggle("hidden",view!=="home");

  if($("#lobbyView"))
    $("#lobbyView").classList.toggle("hidden",view!=="lobby");
}

function renderLobbies(rows){
  const list=$("#lobbyList");
  const empty=$("#emptyLobbies");

  if(!list || !empty) return;

  if(!rows.length){
    list.innerHTML="";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  list.innerHTML=rows.map(l=>`
    <div class="lobby-card">
      <div class="eyebrow">OPEN TABLE</div>
      <h4>${esc(l.name)}</h4>
      <div class="lobby-meta">
        <span>♟ Private</span>
        <span>🪙 ${l.starting_chips.toLocaleString()}</span>
        <span>${l.status}</span>
      </div>
      <button class="secondary join-btn" data-id="${l.id}">
        Join table
      </button>
    </div>
  `).join("");

  $$(".join-btn").forEach(b=>{
    b.onclick=()=>joinLobby(b.dataset.id);
  });
}

async function loadLobbies(){
  const {data,error}=await supabase
    .from("lobbies")
    .select("*")
    .order("created_at",{ascending:false});

  if(error){
    toast(error.message);
    return;
  }

  renderLobbies(data||[]);
}

async function createLobby(){
  const name=$("#newLobbyName").value.trim()||"Friends Table";
  const starting=Number($("#newStartingChips").value)||5000;
  const code=Math.random().toString(36).slice(2,8).toUpperCase();

  const {data,error}=await supabase
    .from("lobbies")
    .insert({
      name,
      invite_code:code,
      host_id:user.id,
      starting_chips:starting,
      game:{phase:"waiting"}
    })
    .select()
    .single();

  if(error){
    toast(error.message);
    return;
  }

  await supabase
    .from("lobby_players")
    .insert({
      lobby_id:data.id,
      user_id:user.id,
      seat:1
    });

  $("#createModal").classList.add("hidden");
  await joinLobby(data.id);
}

async function joinLobby(id){
  const {data:lobby,error}=await supabase
    .from("lobbies")
    .select("*")
    .eq("id",id)
    .single();

  if(error){
    toast(error.message);
    return;
  }

  const {data:players,error:pe}=await supabase
    .from("lobby_players")
    .select("*, profiles(display_name,balance,email)")
    .eq("lobby_id",id)
    .order("seat");

  if(pe){
    toast(pe.message);
    return;
  }

  if(!players.some(p=>p.user_id===user.id)){
    const used=new Set(players.map(p=>p.seat));
    let seat=1;

    while(used.has(seat)) seat++;

    if(seat>7){
      toast("This table is full.");
      return;
    }

    const {error:je}=await supabase
      .from("lobby_players")
      .insert({
        lobby_id:id,
        user_id:user.id,
        seat
      });

    if(je){
      toast(je.message);
      return;
    }
  }

  currentLobby=lobby;
  game=lobby.game||{phase:"waiting"};

  await refreshLobby();
  subscribeLobby();
  show("lobby");
}

async function refreshLobby(){
  if(!currentLobby) return;

  const {data:lobby}=await supabase
    .from("lobbies")
    .select("*")
    .eq("id",currentLobby.id)
    .single();

  if(lobby){
    currentLobby=lobby;
    game=lobby.game||{phase:"waiting"};
  }

  const {data:players}=await supabase
    .from("lobby_players")
    .select("*, profiles(display_name,balance,email)")
    .eq("lobby_id",currentLobby.id)
    .order("seat");

  lobbyPlayers=players||[];

  $("#lobbyTitle").textContent=currentLobby.name;
  $("#copyCodeBtn").textContent=currentLobby.invite_code;
  $("#playerCount").textContent=`${lobbyPlayers.length} / 7`;

  const host=lobbyPlayers.find(
    p=>p.user_id===currentLobby.host_id
  );

  $("#hostLabel").textContent=
    `Host: ${host?.profiles?.display_name||"—"}`;

  myBet=(game?.bets?.[user.id])||0;
  $("#currentBet").textContent=myBet.toLocaleString();

  renderTable();
  await loadChat();
}

function subscribeLobby(){
  if(lobbyChannel)
    supabase.removeChannel(lobbyChannel);

  lobbyChannel=supabase
    .channel("lobby-"+currentLobby.id)

    .on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table:"lobbies",
        filter:`id=eq.${currentLobby.id}`
      },
      refreshLobby
    )

    .on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table:"lobby_players",
        filter:`lobby_id=eq.${currentLobby.id}`
      },
      refreshLobby
    )

    .on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table:"chat_messages",
        filter:`lobby_id=eq.${currentLobby.id}`
      },
      loadChat
    )

    .subscribe();
}

async function loadChat(){
  if(!currentLobby) return;

  const {data}=await supabase
    .from("chat_messages")
    .select("*")
    .eq("lobby_id",currentLobby.id)
    .order("created_at",{ascending:true})
    .limit(80);

  $("#chatLog").innerHTML=(data||[])
    .map(m=>`
      <div class="chat-msg">
        <strong>${esc(m.display_name)}</strong>
        ${esc(m.message)}
      </div>
    `)
    .join("");

  const el=$("#chatLog");
  el.scrollTop=el.scrollHeight;
}

function cardHtml(c,back=false){
  if(back)
    return `<div class="card back">?</div>`;

  const red=c.suit==="♥"||c.suit==="♦";

  return `
    <div class="card ${red?"red":""}">
      <span>${c.rank}</span>
      <span class="suit">${c.suit}</span>
      <span>${c.rank}</span>
    </div>
  `;
}

function renderTable(){
  const dealer=game?.dealer||[];
  const hideHole=
    game?.phase==="playing" &&
    dealer.length>1;

  $("#dealerCards").innerHTML=
    dealer.map((c,i)=>
      cardHtml(c,hideHole&&i===1)
    ).join("");

  const dv=(!hideHole&&dealer.length)
    ?handValue(dealer).total
    :"";

  $("#dealerMeta").textContent=
    hideHole
      ?"Hole card hidden"
      :(dealer.length?`Total ${dv}`:"");

  const phase=game?.phase||"waiting";

  $("#tableStatus").textContent=
    phase==="waiting"
      ?"Set your bets, then the host deals."
      :phase==="playing"
        ?(
          game.turn_user_id===user.id
            ?"Your turn."
            :"Waiting for "+nameOf(game.turn_user_id)+"…"
        )
        :phase==="dealer"
          ?"Dealer is resolving the hand…"
          :phase==="finished"
            ?(game.message||"Round finished.")
            :"";

  $("#playersZone").innerHTML=lobbyPlayers.map(p=>{
    const hand=game?.hands?.[p.user_id]||[];
    const value=handValue(hand);
    const isMe=p.user_id===user.id;
    const bet=game?.bets?.[p.user_id]||0;
    const result=game?.results?.[p.user_id];

    return `
      <div class="seat ${isMe?"me":""}">
        <div class="seat-name">
          ${esc(p.profiles?.display_name||"Player")}
        </div>

        ${p.user_id===currentLobby.host_id
          ?'<div class="seat-host">HOST</div>'
          :""
        }

        <div class="seat-bet">
          <span class="status-dot"></span>
          Bet ${bet.toLocaleString()}
        </div>

        <div class="cards">
          ${hand.map(c=>cardHtml(c)).join("")}
        </div>

        ${hand.length
          ?`<div class="hand-meta">
              ${value.total}${value.soft?" soft":""}
            </div>`
          :""
        }

        ${result
          ?`<div class="seat-result">${esc(result)}</div>`
          :""
        }
      </div>
    `;
  }).join("");

  const myHand=game?.hands?.[user.id]||[];

  const myTurn=
    game?.phase==="playing" &&
    game?.turn_user_id===user.id;

  $("#playerActions").classList.toggle(
    "hidden",
    !myTurn
  );

  $("#dealerActionBtn").classList.toggle(
    "hidden",
    !(
      game?.phase==="dealer" &&
      currentLobby.host_id===user.id
    )
  );

  $("#startRoundBtn").classList.toggle(
    "hidden",
    !(
      phase==="waiting" &&
      currentLobby.host_id===user.id
    )
  );

  $("#startRoundBtn").textContent=
    phase==="waiting"?"Deal round":"";

  $("#doubleBtn").disabled=
    !(
      myHand.length===2 &&
      (profile?.balance||0)>=myBet
    );

  renderDealerBank();
}

function nameOf(id){
  return lobbyPlayers.find(
    p=>p.user_id===id
  )?.profiles?.display_name||"player";
}

function ledgerValue(id){
  return Number(game?.ledger?.[id]||0);
}

function ledgerLabel(id){
  const n=ledgerValue(id);

  if(n>0)
    return `<span class="up">
      Dealer owes ${n.toLocaleString()}
    </span>`;

  if(n<0)
    return `<span class="down">
      Owes dealer ${Math.abs(n).toLocaleString()}
    </span>`;

  return `<span>Settled</span>`;
}

function renderDealerBank(){
  const panel=$("#dealerBankPanel");

  if(!panel) return;

  const isDealer=
    currentLobby?.host_id===user.id;

  panel.classList.toggle(
    "hidden",
    !isDealer
  );

  if(!isDealer) return;

  const sel=$("#dealerPlayerSelect");
  const current=sel.value;

  sel.innerHTML=
    lobbyPlayers
      .filter(p=>p.user_id!==user.id)
      .map(p=>`
        <option value="${p.user_id}">
          ${esc(p.profiles?.display_name||"Player")}
        </option>
      `)
      .join("");

  if(
    [...sel.options]
      .some(o=>o.value===current)
  ){
    sel.value=current;
  }

  $("#dealerLedger").innerHTML=
    lobbyPlayers
      .filter(p=>p.user_id!==user.id)
      .map(p=>{
        const n=ledgerValue(p.user_id);

        const cls=
          n>0
            ?"up"
            :n<0
              ?"down"
              :"even";

        const txt=
          n>0
            ?`+${n.toLocaleString()} (dealer owes)`
            :n<0
              ?`-${Math.abs(n).toLocaleString()} (owes dealer)`
              :"0 (settled)";

        return `
          <div class="ledger-row">
            <span>
              ${esc(p.profiles?.display_name||"Player")}
            </span>
            <strong class="${cls}">
              ${txt}
            </strong>
          </div>
        `;
      })
      .join("")
      ||
      `<div class="muted small">
        No other players yet.
      </div>`;
}

async function dealerAdjust(direction){
  if(currentLobby?.host_id!==user.id){
    toast("Only the dealer can change the ledger.");
    return;
  }

  const target=$("#dealerPlayerSelect").value;
  const amount=Math.floor(
    Number($("#dealerAmount").value)
  );

  if(!target){
    toast("Choose a player.");
    return;
  }

  if(!Number.isFinite(amount)||amount<=0){
    toast("Enter a positive amount.");
    return;
  }

  const g=currentGame();

  g.ledger={
    ...(g.ledger||{})
  };

  g.ledger[target]=
    (g.ledger[target]||0)
    +(direction==="give"?amount:-amount);

  await saveGame(g);

  $("#dealerAmount").value="";
}

function currentGame(){
  return JSON.parse(
    JSON.stringify(game||{})
  );
}

async function saveGame(next){
  game=next;

  const {error}=await supabase
    .from("lobbies")
    .update({
      game,
      status:
        game.phase==="waiting"
          ?"waiting"
          :game.phase==="finished"
            ?"finished"
            :"playing"
    })
    .eq("id",currentLobby.id);

  if(error)
    toast(error.message);
  else
    renderTable();
}

async function setBet(amount){
  amount=Math.floor(amount);

  if(
    !Number.isFinite(amount) ||
    amount<5 ||
    amount%5!==0
  ){
    toast("Bet must be a multiple of 5.");
    return;
  }

  if(amount>profile.balance){
    toast("Not enough virtual chips.");
    return;
  }

  if(
    game?.phase &&
    game.phase!=="waiting"
  ){
    toast("Bets can only be changed before a deal.");
    return;
  }

  const g=currentGame();

  g.bets={
    ...(g.bets||{}),
    [user.id]:amount
  };

  myBet=amount;

  await saveGame(g);
}

async function startRound(){
  if(currentLobby.host_id!==user.id){
    toast("Only the host can deal.");
    return;
  }

  const active=lobbyPlayers.filter(
    p=>(game?.bets?.[p.user_id]||0)>0
  );

  if(!active.length){
    toast("At least one player needs a bet.");
    return;
  }

  const shoe=makeShoe(6);
  const hands={};

  const bets={
    ...(game?.bets||{})
  };

  for(const p of active){
    hands[p.user_id]=[
      shoe.pop(),
      shoe.pop()
    ];
  }

  const dealer=[
    shoe.pop(),
    shoe.pop()
  ];

  const g={
    phase:"playing",
    shoe,
    dealer,
    hands,
    bets,
    results:{},
    ledger:{
      ...(game?.ledger||{})
    },
    turn_user_id:active[0].user_id,
    message:""
  };

  for(const p of active){
    const bet=bets[p.user_id]||0;

    await supabase
      .from("profiles")
      .update({
        balance:Math.max(
          0,
          (p.profiles?.balance||0)-bet
        )
      })
      .eq("id",p.user_id);
  }

  await saveGame(g);
  await getProfile();
}

async function playerAction(type){
  if(
    game?.phase!=="playing" ||
    game.turn_user_id!==user.id
  )
    return;

  const g=currentGame();
  const hand=g.hands[user.id];
  const bet=g.bets[user.id];

  if(type==="hit"){
    g.hands[user.id]=[
      ...hand,
      g.shoe.pop()
    ];

    if(
      handValue(g.hands[user.id]).total>=21
    ){
      g.turn_user_id=
        nextTurn(g,user.id);
    }

  }else if(type==="double"){

    if(
      hand.length!==2 ||
      profile.balance<bet
    ){
      toast("Double unavailable.");
      return;
    }

    await supabase
      .from("profiles")
      .update({
        balance:profile.balance-bet
      })
      .eq("id",user.id);

    g.bets[user.id]=bet*2;

    g.hands[user.id]=[
      ...hand,
      g.shoe.pop()
    ];

    g.turn_user_id=
      nextTurn(g,user.id);

    await getProfile();

  }else if(type==="stand"){
    g.turn_user_id=
      nextTurn(g,user.id);
  }

  if(!g.turn_user_id)
    g.phase="dealer";

  await saveGame(g);
}

function nextTurn(g,current){
  const ids=lobbyPlayers
    .filter(
      p=>(g.bets?.[p.user_id]||0)>0
    )
    .map(p=>p.user_id);

  const idx=ids.indexOf(current);

  for(let i=idx+1;i<ids.length;i++){
    const h=g.hands[ids[i]]||[];

    if(handValue(h).total<21)
      return ids[i];
  }

  return null;
}

async function runDealer(){
  if(
    currentLobby.host_id!==user.id ||
    game?.phase!=="dealer"
  )
    return;

  const g=currentGame();

  while(
    handValue(g.dealer).total<17
  ){
    g.dealer.push(
      g.shoe.pop()
    );
  }

  const dv=handValue(g.dealer).total;
  const results={};

  for(const p of lobbyPlayers){
    const id=p.user_id;
    const bet=g.bets[id]||0;
    const h=g.hands[id]||[];

    if(!bet) continue;

    const pv=handValue(h).total;

    let payout=0;
    let text="";

    if(pv>21){
      text="Bust — lose";
      payout=0;

    }else if(
      isBlackjack(h) &&
      !isBlackjack(g.dealer)
    ){
      text="Blackjack — 3:2";
      payout=Math.floor(bet*2.5);

    }else if(
      isBlackjack(h) &&
      isBlackjack(g.dealer)
    ){
      text="Push";
      payout=bet;

    }else if(
      dv>21 ||
      pv>dv
    ){
      text="Win";
      payout=bet*2;

    }else if(pv===dv){
      text="Push";
      payout=bet;

    }else{
      text="Dealer wins";
      payout=0;
    }

    results[id]=text;

    if(payout){
      await supabase
        .from("profiles")
        .update({
          balance:
            (p.profiles?.balance||0)+payout
        })
        .eq("id",id);
    }
  }

  g.results=results;
  g.phase="finished";
  g.message=
    `Dealer: ${dv}. Start a new round when ready.`;
  g.turn_user_id=null;

  await saveGame(g);
  await getProfile();
}

async function resetRound(){
  if(currentLobby.host_id!==user.id)
    return;

  const g={
    phase:"waiting",
    shoe:[],
    dealer:[],
    hands:{},
    bets:{},
    results:{},
    ledger:{
      ...(game?.ledger||{})
    },
    turn_user_id:null,
    message:""
  };

  await saveGame(g);
  await getProfile();
}

async function leaveLobby(){
  if(!currentLobby)
    return;

  await supabase
    .from("lobby_players")
    .delete()
    .eq("lobby_id",currentLobby.id)
    .eq("user_id",user.id);

  if(lobbyChannel)
    supabase.removeChannel(lobbyChannel);

  currentLobby=null;
  game=null;

  show("home");
  await loadLobbies();
}

async function authSubmit(e){
  e.preventDefault();

  const email=$("#email").value.trim();
  const password=$("#password").value;

  if(!email || !password){
    toast("Enter your email and password.");
    return;
  }

  if(authMode==="login"){

    const {error}=
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if(error)
      toast(error.message);

  }else{

    const display=
      $("#displayName")?.value.trim()||"Player";

    const {error}=
      await supabase.auth.signUp({
        email,
        password,
        options:{
          data:{
            display_name:display
          }
        }
      });

    if(error)
      toast(error.message);
    else
      toast(
        "Account created. Check your email if confirmation is enabled."
      );
  }
}

async function boot(){
  const {data}=await supabase.auth.getSession();

  if(data.session){
    user=data.session.user;

    if(await getProfile())
      enterApp();
  }

  supabase.auth.onAuthStateChange(
    async(_,session)=>{
      user=session?.user||null;

      if(user){

        if(await getProfile())
          enterApp();

      }else{

        $("#authView")?.classList.remove("hidden");
        $("#appView")?.classList.add("hidden");

      }
    }
  );
}

function enterApp(){
  $("#authView")?.classList.add("hidden");
  $("#appView")?.classList.remove("hidden");

  renderBalance();
  loadLobbies();
}


/* AUTH TABS */

$$("[data-auth-tab]").forEach(b=>{

  b.addEventListener("click",(event)=>{

    event.preventDefault();

    authMode=b.dataset.authTab;

    $$("[data-auth-tab]").forEach(x=>{
      x.classList.toggle(
        "active",
        x===b
      );
    });

    const nameWrap=$("#nameWrap");
    const submit=$("#authSubmit");

    if(nameWrap){
      nameWrap.classList.toggle(
        "hidden",
        authMode!=="signup"
      );
    }

    if(submit){
      submit.textContent=
        authMode==="login"
          ?"Log in"
          :"Create account";
    }
  });

});


/* AUTH FORM */

const authForm=$("#authForm");

if(authForm){
  authForm.addEventListener(
    "submit",
    authSubmit
  );
}


/* CREATE LOBBY */

const createLobbyBtn=$("#createLobbyBtn");

if(createLobbyBtn){
  createLobbyBtn.onclick=()=>{
    $("#createModal").classList.remove("hidden");
  };
}

const confirmCreateLobby=$("#confirmCreateLobby");

if(confirmCreateLobby){
  confirmCreateLobby.onclick=createLobby;
}


/* HOME */

const backHomeBtn=$("#backHomeBtn");

if(backHomeBtn){
  backHomeBtn.onclick=()=>{
    if(lobbyChannel)
      supabase.removeChannel(lobbyChannel);

    currentLobby=null;
    show("home");
    loadLobbies();
  };
}


/* PROFILE */

const profileBtn=$("#profileBtn");

if(profileBtn){
  profileBtn.onclick=()=>{
    $("#profileModal").classList.remove("hidden");
  };
}


/* CLOSE BUTTONS */

$$("[data-close]").forEach(b=>{
  b.onclick=()=>{
    const target=$("#"+b.dataset.close);

    if(target)
      target.classList.add("hidden");
  };
});


/* LOGOUT */

const logoutBtn=$("#logoutBtn");

if(logoutBtn){
  logoutBtn.onclick=()=>{
    supabase.auth.signOut();
  };
}


/* COPY INVITE */

const copyCodeBtn=$("#copyCodeBtn");

if(copyCodeBtn){
  copyCodeBtn.onclick=async()=>{
    await navigator.clipboard.writeText(
      currentLobby.invite_code
    );

    toast("Invite code copied.");
  };
}


/* BET BUTTONS */

$$(".chip-btn").forEach(b=>{
  b.onclick=()=>{
    setBet(
      Number(b.dataset.bet)
    );
  };
});

const setBetBtn=$("#setBetBtn");

if(setBetBtn){
  setBetBtn.onclick=()=>{
    setBet(
      Number($("#customBet").value)
    );
  };
}


/* GAME BUTTONS */

const startRoundBtn=$("#startRoundBtn");

if(startRoundBtn){
  startRoundBtn.onclick=async()=>{
    if(game?.phase==="finished")
      await resetRound();
    else
      await startRound();
  };
}

const hitBtn=$("#hitBtn");

if(hitBtn)
  hitBtn.onclick=()=>playerAction("hit");

const standBtn=$("#standBtn");

if(standBtn)
  standBtn.onclick=()=>playerAction("stand");

const doubleBtn=$("#doubleBtn");

if(doubleBtn)
  doubleBtn.onclick=()=>playerAction("double");

const dealerActionBtn=$("#dealerActionBtn");

if(dealerActionBtn)
  dealerActionBtn.onclick=runDealer;


/* DEALER BANK */

const dealerGiveBtn=$("#dealerGiveBtn");
const dealerTakeBtn=$("#dealerTakeBtn");

if(dealerGiveBtn)
  dealerGiveBtn.onclick=()=>dealerAdjust("give");

if(dealerTakeBtn)
  dealerTakeBtn.onclick=()=>dealerAdjust("take");


/* LEAVE */

const leaveLobbyBtn=$("#leaveLobbyBtn");

if(leaveLobbyBtn)
  leaveLobbyBtn.onclick=leaveLobby;


/* CHAT */

const chatForm=$("#chatForm");

if(chatForm){

  chatForm.onsubmit=async e=>{

    e.preventDefault();

    const input=$("#chatInput");
    const message=input.value.trim();

    if(!message || !currentLobby)
      return;

    const {error}=
      await supabase
        .from("chat_messages")
        .insert({
          lobby_id:currentLobby.id,
          user_id:user.id,
          display_name:profile.display_name,
          message
        });

    if(error)
      toast(error.message);

    input.value="";
  };
}


/* START */

boot();
