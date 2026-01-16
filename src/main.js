 import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
 import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, limit, where, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

        // --- CONFIGURACIÓN FIREBASE ---
        const firebaseConfig = {
            apiKey: "AIzaSyDiRY9xyTiQWeJuFCjU7CTBDWcJxDUcVVo",
            authDomain: "real-futbol-950e9.firebaseapp.com",
            projectId: "real-futbol-950e9",
            storageBucket: "real-futbol-950e9.firebasestorage.app",
            messagingSenderId: "997733956346",
            appId: "1:997733956346:web:af680c55a189c9114fe743",
            measurementId: "G-JNGMN81PHB"
        };

        const fbApp = initializeApp(firebaseConfig);
        const db = getFirestore(fbApp);

        const API_BASE = "https://api-proxy.giannirodbol07.workers.dev/api";


        const CACHE_TIME = 10 * 60 * 1000;
        const fetchAPI = async (endpoint) => {
            const cacheKey = "bw_v3_" + endpoint;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { ts, data } = JSON.parse(cached);
                if (Date.now() - ts < CACHE_TIME) return data;
            }

            let res = await fetch(`${API_BASE}${endpoint}`);
            let data = await res.json();

            // Si hay error de quota, intentar backup
            if (data.message && data.message.includes("quota")) {
                console.warn("Cupo agotado, usando respaldo...");
                res = await fetch(`${API_BASE}${endpoint}`, { headers: { "x-apisports-key": BACKUP_KEY } });
                data = await res.json();
            }

            if (data.errors && Object.keys(data.errors).length > 0) {
                console.error("API Error:", data.errors);
                // Lanzar error para mostrar el mensaje de límite alcanzado
                throw new Error("API Limit Reached");
            }

            try {
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
            } catch (e) {
                console.warn("Storage full, clearing old cache...");
                try {
                    // Limpiar todo lo que empiece con bw_v3_ (nuestro prefijo)
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith('bw_v3_')) localStorage.removeItem(key);
                    });
                    // Reintentar guardar
                    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
                } catch (retryErr) {
                    console.error("No se pudo liberar espacio, continuando sin caché.", retryErr);
                }
            }
            return data;
        };



        const state = {
            date: new Date(),
            matches: [],
            liveOnly: false,
            selectedLeague: null,
            season: 2024,
            standingsData: null
        };

        const formatDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        const getDayName = (d) => d.toLocaleDateString('es-AR', { weekday: 'short' }).toUpperCase().replace('.', '');

        window.app = {
            switchTab: (btn, targetId) => {
                document.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.remove('text-white', 'border-b-2', 'border-white');
                    b.classList.add('text-gray-500');
                });
                btn.classList.add('text-white', 'border-b-2', 'border-white');
                btn.classList.remove('text-gray-500');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                document.getElementById(targetId).classList.remove('hidden');

                if (targetId === 'tab-forum' && state.selectedMatch) {
                    app.initForum(`match_${state.selectedMatch.fixture.id}`, 'match-forum-messages', 'match-forum-username');
                }
            },

            init: () => {
                app.renderCalendar();
                app.loadMatches();

                document.getElementById('mobile-menu-btn').onclick = () => {
                    document.getElementById('sidebar').classList.remove('-translate-x-full');
                    document.getElementById('mobile-backdrop').classList.remove('hidden');
                };
                const closeMenu = () => {
                    document.getElementById('sidebar').classList.add('-translate-x-full');
                    document.getElementById('mobile-backdrop').classList.add('hidden');
                };
                document.getElementById('close-sidebar').onclick = closeMenu;
                document.getElementById('mobile-backdrop').onclick = closeMenu;

                document.getElementById('live-toggle').onchange = (e) => {
                    state.liveOnly = e.target.checked;
                    app.renderMatches();
                };



                setInterval(() => app.loadMatches(true), 60000);
            },

            changeDate: (days) => {
                state.date.setDate(state.date.getDate() + days);
                app.renderCalendar();
                app.loadMatches();
            },
            resetDate: () => {
                state.date = new Date();
                app.renderCalendar();
                app.loadMatches();
            },
            renderCalendar: () => {
                const container = document.getElementById('calendar-days');
                const month = document.getElementById('current-month');
                const todayTxt = document.getElementById('current-day-text');
                const months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

                month.innerText = months[state.date.getMonth()];
                const isToday = state.date.toDateString() === new Date().toDateString();
                todayTxt.innerText = isToday ? "HOY" : state.date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).toUpperCase();

                container.innerHTML = '';
                const start = new Date(state.date); start.setDate(start.getDate() - 3);
                for (let i = 0; i < 7; i++) {
                    const d = new Date(start); d.setDate(d.getDate() + i);
                    const isSel = d.toDateString() === state.date.toDateString();
                    const div = document.createElement('div');
                    div.className = `flex flex-col items-center justify-center w-10 h-14 rounded cursor-pointer transition-all ${isSel ? 'bg-white text-black font-bold' : 'hover:bg-[#222] text-gray-500'}`;
                    div.innerHTML = `<span class="text-[9px] font-bold uppercase tracking-widest">${getDayName(d)}</span><span class="text-sm font-bold">${d.getDate()}</span>`;
                    div.onclick = () => { state.date = d; app.renderCalendar(); app.loadMatches(); };
                    container.appendChild(div);
                }
            },

            loadMatches: async (silent = false) => {
                if (!silent) document.getElementById('view-match-list').innerHTML = `<div class="flex justify-center py-20"><div class="loader"></div></div>`;

                const dateStr = formatDate(state.date);
                // Liga IDs:
                // 128: Liga Profesional Argentina, 1032: Trofeo de Campeones Argentina
                // 129: Copa Libertadores, 39: Premier League, 140: La Liga, 78: Bundesliga
                // 71: Serie A, 13: Ligue 1, 11: Serie A Brasil, 135: Serie A Italia, 556: Supercopa España
                // 152: FA Cup, 150: Carabao Cup, 77: Championship
                // 335: Copa del Rey, 61: Ligue 1 Francia
                // 48: Liga Uruguaya, 51: Liga Colombiana, 25: Liga Chilena
                // 371: Club Friendlies
                const targetIds = [128, 1032, 129, 39, 140, 78, 71, 13, 11, 135, 556, 152, 150, 77, 335, 61, 48, 51, 25, 371];

                try {
                    const data = await fetchAPI(`/fixtures?date=${dateStr}&timezone=America/Argentina/Buenos_Aires`);

                    let matches = data.response.filter(m => targetIds.includes(m.league.id));
                    matches.sort((a, b) => {
                        const isArgA = [128, 1032].includes(a.league.id);
                        const isArgB = [128, 1032].includes(b.league.id);
                        if (isArgA && !isArgB) return -1;
                        if (!isArgA && isArgB) return 1;
                        return a.fixture.timestamp - b.fixture.timestamp;
                    });

                    state.matches = matches;
                    app.renderMatches();
                    app.loadMessageCounts();
                } catch (e) {
                    console.error("Full API Error:", e);
                    // Bloquear scroll del contenedor
                    const container = document.getElementById('view-match-list');
                    container.style.overflow = 'hidden';
                    container.style.height = '100%';
                    container.innerHTML = `
                        <div class="flex justify-center items-start pt-4 px-4 h-full">
                            <div class="max-w-md w-full bg-black p-8 text-center">
                                <div class="mb-6">
                                    <h2 class="text-2xl font-black text-white mb-2">¡Estamos a tope! 🚀</h2>
                                </div>
                                <p class="text-gray-300 text-sm leading-relaxed mb-6">
                                    Nuestros servidores han alcanzado su límite por hoy debido a la gran cantidad de usuarios. 
                                    Estamos trabajando para ampliar nuestra capacidad.
                                </p>
                                <div class="border-t border-[#222] my-6"></div>
                                <p class="text-gray-400 text-xs mb-4">
                                    Si te gustaría ayudarnos para que esto no vuelva a suceder, podrías considerar realizar un aporte en la sección donar.
                                </p>
                                <button 
                                    onclick="document.getElementById('donation-modal').classList.remove('hidden')"
                                    class="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 px-6 uppercase tracking-widest text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-yellow-500/50">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path>
                                        <path d="M12 18V6"></path>
                                    </svg>
                                    Donar
                                </button>
                            </div>
                        </div>
                    `;
                }
            },

            renderMatches: () => {
                const container = document.getElementById('view-match-list');
                let list = state.matches;
                if (state.liveOnly) list = list.filter(m => ['1H', 'HT', '2H', 'ET', 'P', 'LIVE'].includes(m.fixture.status.short));

                if (list.length === 0) {
                    container.innerHTML = `<div class="text-center py-20 text-gray-600 uppercase tracking-widest text-xs"><p>${state.liveOnly ? 'No hay partidos en vivo' : 'No hay partidos destacados'}</p></div>`;
                    return;
                }

                const groups = {};
                list.forEach(m => {
                    if (!groups[m.league.id]) groups[m.league.id] = { name: m.league.name, logo: m.league.logo, matches: [] };
                    groups[m.league.id].matches.push(m);
                });

                let html = '';
                Object.values(groups).forEach(g => {
                    html += `<div class="mb-6"><div class="px-2 py-2 flex items-center gap-3"><img src="${g.logo}" class="w-4 h-4 object-contain"><h3 class="text-xs font-bold text-white uppercase tracking-widest">${g.name}</h3></div><div class="space-y-2">`;
                    g.matches.forEach(m => {
                        const s = m.fixture.status;
                        const isLive = ['1H', '2H', 'ET', 'P', 'LIVE'].includes(s.short);
                        const isHT = s.short === 'HT';
                        const isFin = ['FT', 'AET', 'PEN'].includes(s.short);
                        const notStarted = ['NS', 'TBD'].includes(s.short);

                        const timeDisplay = isLive ? `<span class="text-white font-bold animate-pulse text-xs">${s.elapsed}'</span>` : (isHT ? '<span class="text-white font-bold text-xs">ET</span>' : (isFin ? 'FINAL' : new Date(m.fixture.date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })));

                        // LÓGICA DE OPACIDAD PARA PERDEDOR (Solo Finalizados)
                        let homeOpacity = 'opacity-100';
                        let awayOpacity = 'opacity-100';
                        if (isFin) {
                            if ((m.goals.home ?? 0) > (m.goals.away ?? 0)) {
                                awayOpacity = 'opacity-50'; // Visitante pierde
                            } else if ((m.goals.away ?? 0) > (m.goals.home ?? 0)) {
                                homeOpacity = 'opacity-50'; // Local pierde
                            }
                        }

                        // LÓGICA DE GOLEADORES (Lista Vertical)
                        let hScorers = '';
                        let aScorers = '';
                        // LÓGICA DE TARJETAS ROJAS
                        let hRedCards = '';
                        let aRedCards = '';
                        if (m.events && m.events.length > 0) {
                            const goals = m.events.filter(e => e.type === 'Goal');
                            if (goals.length > 0) {
                                // Formatting with alignment classes
                                const formatScorer = (ev, align) => `<div class="truncate leading-tight ${align}">${ev.player.name} ${ev.time.elapsed}'</div>`;

                                const hGoals = goals.filter(e => e.team.id === m.teams.home.id).map(g => formatScorer(g, 'text-right'));
                                const aGoals = goals.filter(e => e.team.id === m.teams.away.id).map(g => formatScorer(g, 'text-left'));

                                if (hGoals.length > 0) hScorers = `<div class="flex flex-col items-end gap-0.5 mt-1 min-w-0 w-full">${hGoals.join('')}</div>`;
                                if (aGoals.length > 0) aScorers = `<div class="flex flex-col items-start gap-0.5 mt-1 min-w-0 w-full">${aGoals.join('')}</div>`;
                            }

                            // Count red cards
                            const redCards = m.events.filter(e => e.type === 'Card' && e.detail === 'Red Card');
                            const hReds = redCards.filter(e => e.team.id === m.teams.home.id).length;
                            const aReds = redCards.filter(e => e.team.id === m.teams.away.id).length;

                            if (hReds > 0) hRedCards = `<div class="flex gap-0.5 ml-1">${'<div class="w-2 h-3 bg-red-600 rounded-sm"></div>'.repeat(hReds)}</div>`;
                            if (aReds > 0) aRedCards = `<div class="flex gap-0.5 mr-1">${'<div class="w-2 h-3 bg-red-600 rounded-sm"></div>'.repeat(aReds)}</div>`;
                        }

                        const clickableClass = notStarted ? 'not-clickable' : 'clickable';
                        const clickAttr = notStarted ? '' : `onclick="app.openDetail(${m.fixture.id})"`;

                        html += `
                        <div class="p-4 match-card ${clickableClass} relative bg-[#0a0a0a] rounded" ${clickAttr}>
                            ${isLive ? '<div class="absolute top-3 right-3"><div class="live-dot"></div></div>' : ''}
                            
                            <div class="flex items-center justify-between">
                                <!-- HOME TEAM -->
                                <div class="flex-1 flex justify-end items-center gap-2 md:gap-3 transition-opacity duration-300 text-right min-w-0">
                                    <div class="flex flex-col items-end min-w-0 max-w-full">
                                        <div class="flex items-center gap-1 w-full justify-end">
                                            <span class="font-bold text-white text-xs md:text-sm uppercase tracking-tight leading-none md:truncate text-wrap">${m.teams.home.name}</span>
                                            ${hRedCards}
                                        </div>
                                        ${hScorers ? `<div class="text-[9px] text-gray-500 font-mono w-full overflow-hidden">${hScorers}</div>` : ''}
                                    </div>
                                    <img src="${m.teams.home.logo}" class="w-8 h-8 object-contain shrink-0">
                                </div>

                                <!-- SCORE / TIME -->
                                <div class="px-2 md:px-3 flex flex-col items-center w-20 md:w-24 shrink-0">
                                    ${notStarted
                                ? `<span class="text-xl font-bold text-gray-600 score-font tracking-tighter">${timeDisplay}</span>`
                                : `<div class="flex gap-2 text-xl md:text-2xl font-black text-white score-font tracking-widest">
                                             <span class="${homeOpacity}">${m.goals.home ?? 0}</span>
                                             <span class="text-gray-700">-</span>
                                             <span class="${awayOpacity}">${m.goals.away ?? 0}</span>
                                           </div>`
                            }
                                    <span class="text-[9px] font-bold uppercase text-gray-500 mt-1 tracking-widest text-center whitespace-nowrap">${isLive || isHT || isFin ? timeDisplay : ''}</span>
                                    <div class="mt-1 px-1.5 py-0.5 bg-[#111] hover:bg-[#222] border border-[#222] rounded flex items-center gap-1 transition-colors cursor-pointer" onclick="app.openDetail(${m.fixture.id}, 'tab-forum'); event.stopPropagation();">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                        <span id="msg-count-${m.fixture.id}" class="text-[8px] font-bold text-gray-500 font-mono">...</span>
                                    </div>
                                </div>

                                <!-- AWAY TEAM -->
                                <div class="flex-1 flex justify-start items-center gap-2 md:gap-3 transition-opacity duration-300 text-left min-w-0">
                                    <img src="${m.teams.away.logo}" class="w-8 h-8 object-contain shrink-0">
                                    <div class="flex flex-col items-start min-w-0 max-w-full">
                                        <div class="flex items-center gap-1 w-full justify-start">
                                            ${aRedCards}
                                            <span class="font-bold text-white text-xs md:text-sm uppercase tracking-tight leading-none md:truncate text-wrap">${m.teams.away.name}</span>
                                        </div>
                                        ${aScorers ? `<div class="text-[9px] text-gray-500 font-mono w-full overflow-hidden">${aScorers}</div>` : ''}
                                    </div>
                                </div>
                            </div>


                        </div>`;
                    });
                    html += `</div></div>`;
                });
                container.innerHTML = html;
                app.loadMessageCounts();
            },

            loadMessageCounts: async () => {
                const matches = state.matches;
                const batchPromises = matches.map(async m => {
                    try {
                        const q = query(collection(db, "forum_messages"), where("context", "==", `match_${m.fixture.id}`));
                        const snapshot = await getCountFromServer(q);
                        const count = snapshot.data().count;
                        const el = document.getElementById(`msg-count-${m.fixture.id}`);
                        if (el) el.innerText = count > 0 ? count : '';
                    } catch (e) { console.error(e); }
                });
            },

            // --- DETALLE DE PARTIDO ---
            openDetail: async (id, initialTab = null) => {
                const m = state.matches.find(x => x.fixture.id == id);
                if (!m) return;
                state.selectedMatch = m;

                document.getElementById('view-match-detail').classList.remove('hidden');
                document.body.style.overflow = 'hidden';
                document.getElementById('detail-content-wrapper').classList.add('hidden');
                document.getElementById('detail-loader').classList.remove('hidden');

                // Datos básicos
                document.getElementById('detail-home-logo').src = m.teams.home.logo;
                document.getElementById('detail-away-logo').src = m.teams.away.logo;
                document.getElementById('detail-home-score').innerText = m.goals.home ?? 0;
                document.getElementById('detail-away-score').innerText = m.goals.away ?? 0;
                document.getElementById('detail-status').innerText = m.fixture.status.long;

                // Count red cards for detail view
                let homeRedCardsHTML = '';
                let awayRedCardsHTML = '';
                if (m.events && m.events.length > 0) {
                    const redCards = m.events.filter(e => e.type === 'Card' && e.detail === 'Red Card');
                    const hReds = redCards.filter(e => e.team.id === m.teams.home.id).length;
                    const aReds = redCards.filter(e => e.team.id === m.teams.away.id).length;

                    if (hReds > 0) homeRedCardsHTML = '<div class="flex gap-1 justify-center mt-1">' + '<div class="w-3 h-4 bg-red-600 rounded-sm"></div>'.repeat(hReds) + '</div>';
                    if (aReds > 0) awayRedCardsHTML = '<div class="flex gap-1 justify-center mt-1">' + '<div class="w-3 h-4 bg-red-600 rounded-sm"></div>'.repeat(aReds) + '</div>';
                }

                document.getElementById('detail-home-name').innerHTML = m.teams.home.name + homeRedCardsHTML;
                document.getElementById('detail-away-name').innerHTML = m.teams.away.name + awayRedCardsHTML;

                // Goleadores Header (Actualización Inmediata) - Centrado
                const hList = document.getElementById('detail-home-scorers-list');
                const aList = document.getElementById('detail-away-scorers-list');
                hList.innerHTML = '';
                aList.innerHTML = '';

                if (m.events && m.events.length > 0) {
                    const goals = m.events.filter(e => e.type === 'Goal');
                    const formatScorer = (ev) => `<div class="truncate leading-tight max-w-[120px] text-center">${ev.player.name} ${ev.time.elapsed}'</div>`;

                    const hGoals = goals.filter(e => e.team.id === m.teams.home.id).map(formatScorer);
                    if (hGoals.length > 0) hList.innerHTML = hGoals.join('');

                    const aGoals = goals.filter(e => e.team.id === m.teams.away.id).map(formatScorer);
                    if (aGoals.length > 0) aList.innerHTML = aGoals.join('');
                }

                try {
                    const data = await fetchAPI(`/fixtures?id=${id}`);
                    const fullMatch = data.response[0];

                    app.renderTimeline(fullMatch);
                    app.renderLineups(fullMatch);
                    app.renderStats(fullMatch);
                } catch (e) { console.error(e); }

                document.getElementById('detail-loader').classList.add('hidden');
                document.getElementById('detail-content-wrapper').classList.remove('hidden');

                // Switch to requested tab if any
                if (initialTab) {
                    const btn = document.querySelector(`.tab-btn[data-target="${initialTab}"]`);
                    if (btn) btn.click();
                } else {
                    // Default to timeline
                    const btn = document.querySelector(`.tab-btn[data-target="tab-timeline"]`);
                    if (btn) btn.click();
                }
            },

            closeDetail: () => {
                document.getElementById('view-match-detail').classList.add('hidden');
                document.body.style.overflow = '';
            },

            renderTimeline: (m) => {
                const c = document.getElementById('tab-timeline');
                let ev = [...(m.events || [])];

                // Ordenar: Más reciente arriba (Descendente)
                ev.sort((a, b) => {
                    const tA = a.time.elapsed + (a.time.extra || 0);
                    const tB = b.time.elapsed + (b.time.extra || 0);
                    if (tA === tB) return 0;
                    return tA > tB ? -1 : 1;
                });

                if (ev.length === 0) { c.innerHTML = '<div class="text-center py-10 text-gray-600 text-xs uppercase tracking-widest">Sin eventos</div>'; return; }

                c.innerHTML = ev.map(e => {
                    const isHome = e.team.id === m.teams.home.id;
                    const sideClass = isHome ? 'flex-row' : 'flex-row-reverse';
                    const boxClass = isHome ? '' : 'flex-row-reverse text-right';

                    let content = '';
                    if (e.type === 'subst') {
                        content = `
                            <div class="flex flex-col gap-0.5">
                                <span class="text-xs font-bold text-green-400 uppercase">Entra: ${e.player.name}</span>
                                <span class="text-[10px] font-bold text-red-400 uppercase opacity-70">Sale: ${e.assist.name}</span>
                            </div>
                        `;
                    } else {
                        content = `
                            <span class="text-sm font-bold text-white">${e.player.name}</span>
                            <span class="text-[9px] px-2 py-0.5 uppercase font-bold tracking-wider ${e.type === 'Goal' ? 'bg-white text-black' : 'bg-[#333] text-gray-400'}">${e.type === 'Goal' ? 'GOL' : e.detail}</span>
                        `;
                    }

                    return `
                    <div class="flex items-center gap-4 mb-4 ${sideClass}">
                        <div class="w-8 text-center text-xs font-bold text-gray-500 font-mono">${e.time.elapsed}'</div>
                        <div class="bg-[#111] border border-[#222] px-4 py-3 flex items-center gap-3 ${boxClass} min-w-[140px]">
                            ${content}
                        </div>
                    </div>
                `}).join('');
            },

            renderLineups: (m) => {
                const pitch = document.getElementById('football-pitch');
                pitch.querySelectorAll('.player-marker').forEach(el => el.remove());
                const hList = document.getElementById('lineup-home-list');
                const aList = document.getElementById('lineup-away-list');

                if (!m.lineups || m.lineups.length === 0) {
                    hList.innerHTML = 'No disponible'; aList.innerHTML = 'No disponible'; return;
                }

                const homeL = m.lineups[0];
                const awayL = m.lineups[1];
                const events = m.events || [];

                // Debugging for User
                console.log("Processing Lineups & Events", { eventsCount: events.length, lineups: m.lineups });
                console.log("All Events:", events);
                console.log("Substitution Events:", events.filter(e => e.type === 'subst'));
                console.log("Event Types Found:", [...new Set(events.map(e => e.type))]);

                // Helper to safely check ID match
                const idsMatch = (id1, id2) => String(id1) === String(id2);

                // Render Lists (Starters + Subs)
                const renderList = (lineup) => {
                    // Starters
                    let html = lineup.startXI.map(p => {
                        // Check if subbed out - handle multiple event type names
                        const subOut = events.find(e => {
                            const eventType = (e.type || '').toLowerCase();
                            return (eventType === 'subst' || eventType === 'substitution') && e.assist && idsMatch(e.assist.id, p.player.id);
                        });
                        const subInfo = subOut ? `<span class="text-red-400 text-[10px] ml-2 font-bold">▼ ${subOut.time.elapsed}'</span>` : '';

                        return `<div class="flex justify-between border-b border-[#222] py-1.5 items-center">
                            <div class="flex items-center gap-2"><span class="text-gray-300 transition-colors">${p.player.name}</span>${subInfo}</div>
                            <span class="text-gray-600 font-mono text-xs">${p.player.number}</span>
                        </div>`;
                    }).join('');

                    if (lineup.substitutes && lineup.substitutes.length > 0) {
                        html += `<div class="mt-4 mb-2 text-xs font-bold text-gray-500 uppercase tracking-widest">Suplentes</div>`;
                        html += lineup.substitutes.map(p => {
                            // Check if subbed in - handle multiple event type names
                            const subIn = events.find(e => {
                                const eventType = (e.type || '').toLowerCase();
                                return (eventType === 'subst' || eventType === 'substitution') && e.player && idsMatch(e.player.id, p.player.id);
                            });
                            const subInfo = subIn ? `<span class="text-green-400 text-[10px] ml-2 font-bold">▲ ${subIn.time.elapsed}'</span>` : '';

                            return `<div class="flex justify-between border-b border-[#222] py-1.5 items-center">
                                <div class="flex items-center gap-2"><span class="text-gray-400 text-sm">${p.player.name}</span>${subInfo}</div>
                                <span class="text-gray-600 font-mono text-xs">${p.player.number}</span>
                            </div>`;
                        }).join('');
                    }
                    return html;
                };

                hList.innerHTML = renderList(homeL);
                aList.innerHTML = renderList(awayL);

                const addPlayers = (lineup, side) => {
                    const players = lineup.startXI;
                    const formation = lineup.formation;

                    let lines = {};
                    let hasGrid = players.every(p => p.player.grid);

                    if (hasGrid) {
                        players.forEach(p => {
                            const parts = p.player.grid.split(':');
                            const lineIdx = parseInt(parts[0]);
                            if (!lines[lineIdx]) lines[lineIdx] = [];
                            lines[lineIdx].push(p);
                        });
                    } else {
                        let formationParts = formation ? formation.split('-').map(Number) : [4, 4, 2];
                        formationParts.unshift(1);
                        let playerIdx = 0;
                        formationParts.forEach((count, i) => {
                            const lineIdx = i + 1;
                            lines[lineIdx] = [];
                            for (let k = 0; k < count; k++) {
                                if (playerIdx < players.length) {
                                    lines[lineIdx].push(players[playerIdx]);
                                    playerIdx++;
                                }
                            }
                        });
                    }

                    Object.keys(lines).forEach(lineKey => {
                        const lineIdx = parseInt(lineKey);
                        const linePlayers = lines[lineKey];
                        if (hasGrid) {
                            linePlayers.sort((a, b) => {
                                const rowA = parseInt(a.player.grid.split(':')[1]);
                                const rowB = parseInt(b.player.grid.split(':')[1]);
                                return rowA - rowB;
                            });
                        }

                        const count = linePlayers.length;
                        linePlayers.forEach((p, index) => {
                            const el = document.createElement('div');
                            el.className = `player-marker ${side === 'home' ? 'home-player' : 'away-player'}`;

                            // Substitution Logic for Marker
                            let displayNumber = p.player.number;
                            let displayName = p.player.name;
                            let isSubbed = false;
                            let subInName = '';

                            // Check if this starter was subbed OUT
                            const subOutEvent = events.find(e => e.type === 'subst' && e.assist && idsMatch(e.assist.id, p.player.id));

                            if (subOutEvent) {
                                isSubbed = true;
                                // Find who came IN (Jersey number needs lookup in subs list)
                                const subInPlayer = lineup.substitutes.find(s => idsMatch(s.player.id, subOutEvent.player.id));
                                if (subInPlayer) {
                                    displayNumber = subInPlayer.player.number;
                                    subInName = subInPlayer.player.name;
                                } else {
                                    subInName = subOutEvent.player.name;
                                    displayNumber = "⇄";
                                }
                            }

                            // Content: Number
                            el.innerHTML = `<span class="text-xs font-bold font-mono pointer-events-none">${displayNumber}</span>`;

                            // Goal Check
                            const playerGoals = events.filter(e => e.type === 'Goal' && (idsMatch(e.player.id, p.player.id) || (isSubbed && subOutEvent && idsMatch(e.player.id, subOutEvent.player.id))));

                            if (playerGoals.length > 0) {
                                const ballIcon = document.createElement('div');
                                ballIcon.className = `absolute -top-2 -right-2 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-black shadow-sm z-20`;
                                const isOwn = playerGoals[playerGoals.length - 1].detail === 'Own Goal';
                                ballIcon.innerHTML = isOwn
                                    ? `<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div>`
                                    : `<div class="w-full h-full rounded-full bg-white flex items-center justify-center"><div class="w-1.5 h-1.5 bg-black rounded-full opacity-80"></div></div>`;
                                el.appendChild(ballIcon);
                            }

                            // Calculate Layout
                            let x;
                            if (side === 'home') {
                                x = 4 + (lineIdx - 1) * 11;
                                if (lineIdx === 1) x = 2;
                            } else {
                                x = 96 - (lineIdx - 1) * 11;
                                if (lineIdx === 1) x = 98;
                            }

                            const segment = 100 / (count + 1);
                            let y = segment * (index + 1);
                            if (y < 5) y = 5; if (y > 95) y = 95;

                            el.style.left = x + '%';
                            el.style.top = y + '%';

                            // Name Label Rendering with Stacked info
                            const nameEl = document.createElement('div');
                            nameEl.className = `absolute -bottom-7 left-1/2 -translate-x-1/2 text-[8px] font-bold whitespace-nowrap bg-black/80 px-2 py-1 rounded flex flex-col items-center leading-none z-30 border border-[#333] pointer-events-none`;

                            if (isSubbed) {
                                const inNameShort = subInName.split(' ').pop();
                                const outNameShort = displayName.split(' ').pop();
                                nameEl.innerHTML = `<span class="text-white mb-0.5">${inNameShort}</span><span class="text-gray-400 opacity-50 text-[7px]">${outNameShort}</span>`;
                            } else {
                                const shortName = displayName.split(' ').pop();
                                nameEl.innerHTML = `<span class="text-white">${shortName}</span>`;
                            }
                            el.appendChild(nameEl);

                            el.onclick = () => {
                                document.getElementById('modal-player-name').innerText = p.player.name;
                                document.getElementById('player-modal').classList.remove('hidden');
                            };
                            pitch.appendChild(el);
                        });
                    });
                };

                addPlayers(homeL, 'home');
                addPlayers(awayL, 'away');
            },

            renderStats: (m) => {
                const c = document.getElementById('tab-stats');
                if (!m.statistics || m.statistics.length === 0) { c.innerHTML = 'No disponible'; return; }
                const statsTypes = [
                    { api: 'Ball Possession', es: 'Posesión' },
                    { api: 'Total Shots', es: 'Tiros Totales' },
                    { api: 'Shots on Goal', es: 'Tiros al Arco' },
                    { api: 'Corner Kicks', es: 'Tiros de Esquina' },
                    { api: 'Fouls', es: 'Faltas' },
                    { api: 'Yellow Cards', es: 'Tarjetas Amarillas' },
                    { api: 'Red Cards', es: 'Tarjetas Rojas' }
                ];
                const hStats = m.statistics[0].statistics;
                const aStats = m.statistics[1].statistics;

                c.innerHTML = statsTypes.map(stat => {
                    const hVal = hStats.find(s => s.type === stat.api)?.value || 0;
                    const aVal = aStats.find(s => s.type === stat.api)?.value || 0;
                    const hNum = parseInt(hVal);
                    const aNum = parseInt(aVal);
                    const total = hNum + aNum || 1;
                    const hPerc = (hNum / total) * 100;

                    return `
                    <div class="bg-[#111] p-4 border border-[#222]">
                        <div class="flex justify-between text-[10px] font-bold text-gray-400 uppercase mb-3 tracking-widest">
                            <span>${hVal}</span><span>${stat.es}</span><span>${aVal}</span>
                        </div>
                        <div class="h-1 bg-[#333] flex overflow-hidden">
                            <div class="h-full bg-white" style="width: ${hPerc}%"></div>
                            <div class="h-full bg-[#555]" style="width: ${100 - hPerc}%"></div>
                        </div>
                    </div>`;
                }).join('');

            },

            changeSeason: (y) => { state.season = y; if (state.selectedLeague) app.showStandings(state.selectedLeague.id, state.selectedLeague.name); },

            showStandings: async (id, name) => {
                state.selectedLeague = { id, name };
                document.getElementById('view-match-list').classList.add('hidden');
                document.getElementById('date-nav').classList.add('hidden');
                document.getElementById('view-standings').classList.remove('hidden');
                document.getElementById('standings-title').innerText = name;
                document.getElementById('standings-tabs').classList.add('hidden');

                document.getElementById('sidebar').classList.add('-translate-x-full');
                document.getElementById('mobile-backdrop').classList.add('hidden');

                const container = document.getElementById('standings-container');
                container.innerHTML = `<div class="flex justify-center py-20"><div class="loader"></div></div>`;

                try {
                    const data = await fetchAPI(`/standings?league=${id}&season=${state.season}`);
                    const standings = data.response[0].league.standings;
                    app.processStandings(standings);
                } catch (e) {
                    container.innerHTML = `<div class="text-center text-gray-500 py-10 text-xs uppercase tracking-widest">Sin datos para ${state.season}.</div>`;
                }
            },

            processStandings: (standingsData) => {
                const tabs = document.getElementById('standings-tabs');
                if (standingsData.length > 1) {
                    tabs.classList.remove('hidden');
                    tabs.innerHTML = standingsData.map((g, i) => `
                        <button onclick="app.renderTable(${i})" class="px-4 py-2 bg-[#111] text-xs font-bold uppercase border border-[#333] text-gray-400 hover:text-white hover:border-white transition-all whitespace-nowrap">
                            ${g[0].group}
                        </button>
                    `).join('');
                    state.standingsData = standingsData;
                    app.renderTable(0);
                } else {
                    tabs.classList.add('hidden');
                    state.standingsData = standingsData;
                    app.renderTable(0);
                }
            },

            renderTable: (groupIndex) => {
                const table = state.standingsData[groupIndex];
                const container = document.getElementById('standings-container');
                container.innerHTML = `
                <div class="bg-[#0a0a0a] border border-[#222] overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-left text-gray-400">
                            <thead class="text-[10px] text-gray-500 uppercase bg-[#111] border-b border-[#222] tracking-widest">
                                <tr>
                                    <th class="px-4 py-3 text-center w-10">#</th>
                                    <th class="px-3 py-3">Equipo</th>
                                    <th class="px-2 py-3 text-center text-white">Pts</th>
                                    <th class="px-2 py-3 text-center">PJ</th>
                                    <th class="px-2 py-3 text-center font-mono">DG</th>
                                    <th class="px-2 py-3 text-center hidden sm:table-cell">Forma</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-[#1a1a1a]">
                                ${table.map(t => `
                                    <tr class="hover:bg-[#111] transition-colors">
                                        <td class="px-4 py-3 text-center font-bold ${t.rank <= 4 ? 'text-white' : 'text-gray-600'}">${t.rank}</td>
                                        <td class="px-3 py-3 font-bold text-gray-300 flex items-center gap-3 whitespace-nowrap uppercase text-xs">
                                            <img src="${t.team.logo}" class="w-5 h-5 object-contain">
                                            ${t.team.name}
                                        </td>
                                        <td class="px-2 py-3 text-center font-bold text-white">${t.points}</td>
                                        <td class="px-2 py-3 text-center font-mono text-xs">${t.all.played}</td>
                                        <td class="px-2 py-3 text-center font-mono text-xs ${t.goalsDiff > 0 ? 'text-white' : 'text-gray-600'}">${t.goalsDiff > 0 ? '+' : ''}${t.goalsDiff}</td>
                                        <td class="px-2 py-3 text-center hidden sm:table-cell">
                                            <div class="flex justify-center gap-0.5">
                                                ${t.form ? t.form.split('').slice(-5).map(f => `<div class="w-1.5 h-1.5 rounded-full ${f === 'W' ? 'bg-white' : (f === 'D' ? 'bg-gray-500' : 'bg-[#333]')}"></div>`).join('') : '-'}
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`;
            },

            navigateToMatches: () => {
                document.getElementById('view-standings').classList.add('hidden');
                document.getElementById('view-forum').classList.add('hidden');
                document.getElementById('view-match-list').classList.remove('hidden');
                document.getElementById('date-nav').classList.remove('hidden');
                document.getElementById('sidebar').classList.add('-translate-x-full');
                document.getElementById('mobile-backdrop').classList.add('hidden');

                // Nav Highlight
                app.updateMobileNav('btn-nav-results');
            },

            openMobileTab: (tabName) => {
                const sidebar = document.getElementById('sidebar');
                if (tabName === 'leagues') {
                    sidebar.classList.remove('-translate-x-full');
                    app.updateMobileNav('btn-nav-leagues');
                } else {
                    sidebar.classList.add('-translate-x-full');
                }
            },

            navigateToForum: () => {
                document.getElementById('view-match-list').classList.add('hidden');
                document.getElementById('view-standings').classList.add('hidden');
                document.getElementById('date-nav').classList.add('hidden');
                document.getElementById('view-forum').classList.remove('hidden');

                document.getElementById('sidebar').classList.add('-translate-x-full');
                document.getElementById('mobile-backdrop').classList.add('hidden');

                document.getElementById('mobile-backdrop').classList.add('hidden');

                app.initForum('global', 'forum-messages', 'forum-username');

                // Nav Highlight
                app.updateMobileNav('btn-nav-forum');
            },

            updateMobileNav: (activeId) => {
                ['btn-nav-results', 'btn-nav-leagues', 'btn-nav-forum'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (!btn) return;
                    if (id === activeId) {
                        btn.classList.remove('text-gray-400');
                        btn.classList.add('text-white');
                    } else {
                        btn.classList.add('text-gray-400');
                        btn.classList.remove('text-white');
                    }
                });
            },

            toggleLiveFilter: () => {
                const isChecked = document.getElementById('live-toggle').checked;
                state.liveOnly = isChecked;
                app.renderMatches();
            },

            initForum: (context, containerId, usernameInputId) => {
                // Desuscribirse del anterior si existe
                if (app.activeForumUnsubscribe) {
                    app.activeForumUnsubscribe();
                    app.activeForumUnsubscribe = null;
                }

                app.currentForumContext = context;

                // Query con filtro de contexto SIN orderBy para evitar indice
                const q = query(
                    collection(db, "forum_messages"),
                    where("context", "==", context)
                );

                app.activeForumUnsubscribe = onSnapshot(q, (snapshot) => {
                    const container = document.getElementById(containerId);
                    if (!container) return;

                    if (snapshot.empty) {
                        container.innerHTML = '<div class="text-center text-gray-600 py-10 text-xs uppercase tracking-widest">Sé el primero en escribir.</div>';
                        return;
                    }

                    const messages = [];
                    snapshot.forEach(doc => messages.push(doc.data()));

                    // Client-side Sort
                    messages.sort((a, b) => a.timestamp - b.timestamp);

                    container.innerHTML = messages.map(msg => {
                        const isMe = localStorage.getItem('chat_username') === msg.user;
                        const date = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                        return `
                        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} mb-3 animate-fade-in">
                            <span class="text-[10px] text-gray-500 font-bold uppercase mb-1 px-1">${msg.user} <span class="font-normal text-[#444] ml-1">${date}</span></span>
                            <div class="${isMe ? 'bg-white text-black border-white' : 'bg-[#111] text-gray-300 border-[#333]'} border px-3 py-2 rounded-lg max-w-[85%] text-sm break-words shadow-sm">
                                ${msg.text}
                            </div>
                        </div>`;
                    }).join('');

                    // Auto scroll to bottom
                    container.scrollTop = container.scrollHeight;
                });

                // Pre-fill username if exists
                const savedUser = localStorage.getItem('chat_username');
                if (savedUser) {
                    const inp = document.getElementById(usernameInputId);
                    if (inp) inp.value = savedUser;
                }
            },

            sendMessage: async (userFieldId, textFieldId) => {
                const userInp = document.getElementById(userFieldId);
                const textInp = document.getElementById(textFieldId);
                const user = userInp.value.trim();
                const text = textInp.value.trim();

                if (!user) { alert("Por favor ingresa un nombre o usuario."); return; }
                if (!text) return;

                localStorage.setItem('chat_username', user);

                try {
                    await addDoc(collection(db, "forum_messages"), {
                        context: app.currentForumContext || 'global',
                        user: user,
                        text: text,
                        timestamp: Date.now()
                    });
                    textInp.value = '';
                } catch (e) {
                    console.error("Error sending message: ", e);
                    alert("Error al enviar mensaje.");
                }
            }
        };

        app.init();
    </script>
