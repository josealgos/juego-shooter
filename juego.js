// Conexión con el servidor
const socket = io();

// Variables del juego
let jugadorActual = null;
let jugadores = new Map();
let balas = new Map();
let salaActual = null;
let esCreador = false;
let miId = null;
let mapaActual = null;
let tiempoRespawn = 0;
let intervaloRespawn = null;
let gridPattern = null;

// Variables para el temporizador
let tiempoRestante = 300;
let intervaloReloj = null;
let elementoReloj = null;

// Controles
const teclas = {};
const velocidadMovimiento = 5;

// Canvas
const canvas = document.getElementById('juego-canvas');
const ctx = canvas.getContext('2d');
let animacionFrame;

// Elementos del DOM
const menuPrincipal = document.getElementById('menu-principal');
const crearSalaDiv = document.getElementById('crear-sala');
const unirseSalaDiv = document.getElementById('unirse-sala');
const salaEsperaDiv = document.getElementById('sala-espera');
const hud = document.getElementById('hud');
const notificacionesDiv = document.getElementById('notificaciones');

// Inputs
const nombrePlayer = document.getElementById('nombre-player');
const nombreSala = document.getElementById('nombre-sala');
const maxJugadores = document.getElementById('max-jugadores');
const codigoSala = document.getElementById('codigo-sala');

// Elementos de sala de espera
const salaNombre = document.getElementById('sala-nombre');
const salaCodigo = document.getElementById('sala-codigo');
const listaJugadores = document.getElementById('lista-jugadores');
const contadorJugadores = document.getElementById('contador-jugadores');
const btnListo = document.getElementById('btn-listo');
const btnIniciar = document.getElementById('btn-iniciar');

// Elementos del HUD
const vidaJugadorSpan = document.getElementById('vida-jugador');
const balasJugadorSpan = document.getElementById('balas-jugador');
const puntuacionJugadorSpan = document.getElementById('puntuacion-jugador');

// Variables para el selector de personajes
let selectorPersonajesVisible = false;
let imagenesPersonajes = {};

// VARIABLE PARA COOLDOWN LOCAL DE DISPARO
let ultimoDisparoLocal = 0;
const COOLDOWN_DISPARO = 300; // 300ms

// Precargar imágenes de personajes
function precargarImagenes() {
    for (let i = 1; i <= 3; i++) {
        const img = new Image();
        img.src = `IMG/personaje${i}.png`;
        imagenesPersonajes[i] = img;
    }
}

precargarImagenes();

// ============================================
// FUNCIONES DE NOTIFICACIÓN
// ============================================
function mostrarNotificacion(mensaje, tipo = 'info') {
    const notificacion = document.createElement('div');
    notificacion.className = 'notificacion';
    notificacion.textContent = mensaje;
    
    switch(tipo) {
        case 'exito':
            notificacion.style.borderLeftColor = '#00ff00';
            notificacion.style.background = 'linear-gradient(45deg, rgba(0,255,0,0.2), rgba(0,200,0,0.3))';
            break;
        case 'error':
            notificacion.style.borderLeftColor = '#ff3366';
            notificacion.style.background = 'linear-gradient(45deg, rgba(255,51,102,0.2), rgba(255,0,102,0.3))';
            notificacion.style.boxShadow = '0 0 20px rgba(255,51,102,0.5)';
            notificacion.style.fontWeight = 'bold';
            break;
        default:
            notificacion.style.borderLeftColor = '#00ffff';
            notificacion.style.background = 'linear-gradient(45deg, rgba(0,255,255,0.2), rgba(0,200,255,0.3))';
    }
    
    notificacionesDiv.appendChild(notificacion);
    
    const duracion = tipo === 'error' ? 2000 : 3000;
    
    setTimeout(() => {
        notificacion.style.animation = 'notificacion-salida 0.3s ease';
        setTimeout(() => {
            notificacion.remove();
        }, 300);
    }, duracion);
}

// Añadir animación de salida
const estiloAnimacion = document.createElement('style');
estiloAnimacion.textContent = `
    @keyframes notificacion-salida {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100px);
        }
    }
`;
document.head.appendChild(estiloAnimacion);

// ============================================
// FUNCIONES DE MENÚ
// ============================================
document.getElementById('btn-crear-sala').addEventListener('click', () => {
    if (!nombrePlayer.value.trim()) {
        mostrarNotificacion('❌ Por favor ingresa tu nombre', 'error');
        return;
    }
    menuPrincipal.style.display = 'none';
    crearSalaDiv.style.display = 'block';
});

document.getElementById('btn-unirse-sala').addEventListener('click', () => {
    if (!nombrePlayer.value.trim()) {
        mostrarNotificacion('❌ Por favor ingresa tu nombre', 'error');
        return;
    }
    menuPrincipal.style.display = 'none';
    unirseSalaDiv.style.display = 'block';
});

document.getElementById('btn-volver-menu').addEventListener('click', () => {
    crearSalaDiv.style.display = 'none';
    menuPrincipal.style.display = 'block';
});

document.getElementById('btn-volver-menu2').addEventListener('click', () => {
    unirseSalaDiv.style.display = 'none';
    menuPrincipal.style.display = 'block';
});

document.getElementById('btn-confirmar-crear').addEventListener('click', () => {
    if (!nombreSala.value.trim()) {
        mostrarNotificacion('❌ Ingresa el nombre de la sala', 'error');
        return;
    }
    
    mostrarNotificacion('🔄 Creando sala...', 'info');
    
    socket.emit('crearSala', {
        nombreSala: nombreSala.value.trim(),
        maxJugadores: parseInt(maxJugadores.value),
        nombreJugador: nombrePlayer.value.trim()
    });
});

document.getElementById('btn-confirmar-unirse').addEventListener('click', () => {
    if (!codigoSala.value.trim()) {
        mostrarNotificacion('❌ Ingresa el código de la sala', 'error');
        return;
    }
    
    mostrarNotificacion('🔄 Uniéndose a la sala...', 'info');
    
    socket.emit('unirseSala', {
        codigoSala: codigoSala.value.trim().toUpperCase(),
        nombreJugador: nombrePlayer.value.trim()
    });
});

btnListo.addEventListener('click', () => {
    socket.emit('marcarListo');
    btnListo.disabled = true;
    btnListo.textContent = '✅ ¡LISTO!';
    mostrarNotificacion('¡Estás listo! Esperando a los demás...', 'exito');
});

btnIniciar.addEventListener('click', () => {
    mostrarNotificacion('🎮 Iniciando partida...', 'info');
    socket.emit('iniciarPartida');
});

// ============================================
// SELECTOR DE PERSONAJES
// ============================================
function crearSelectorPersonajes() {
    const selectorExistente = document.getElementById('selector-personajes');
    if (selectorExistente) {
        selectorExistente.remove();
    }
    
    const selectorDiv = document.createElement('div');
    selectorDiv.id = 'selector-personajes';
    selectorDiv.className = 'selector-personajes';
    
    selectorDiv.innerHTML = `
        <h2>🎭 SELECCIONA TU PERSONAJE</h2>
        <div class="personajes-container">
            ${[1, 2, 3].map(num => `
                <div class="personaje-card" onclick="seleccionarPersonaje(${num})">
                    <img src="IMG/personaje${num}.png" 
                         onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22150%22 height=%22150%22><rect width=%22150%22 height=%22150%22 fill=%22%23333%22/><text x=%2275%22 y=%2275%22 fill=%22%23fff%22 text-anchor=%22middle%22>Personaje ${num}</text></svg>'">
                    <h3>PERSONAJE ${num}</h3>
                    <button class="btn">ELEGIR</button>
                </div>
            `).join('')}
        </div>
        <div class="selector-footer">
            <p>Presiona ESC para cerrar</p>
            <p class="highlight">✨ Puedes cambiar de personaje durante la partida presionando M</p>
        </div>
    `;
    
    document.body.appendChild(selectorDiv);
}

window.seleccionarPersonaje = function(numero) {
    socket.emit('cambiarPersonaje', { personaje: numero });
    toggleSelectorPersonajes();
    mostrarNotificacion(`🎭 Personaje ${numero} seleccionado`, 'exito');
};

function toggleSelectorPersonajes() {
    selectorPersonajesVisible = !selectorPersonajesVisible;
    const selector = document.getElementById('selector-personajes');
    if (selector) {
        selector.style.display = selectorPersonajesVisible ? 'block' : 'none';
    } else if (selectorPersonajesVisible) {
        crearSelectorPersonajes();
    }
}

// ============================================
// FUNCIONES DEL TEMPORIZADOR
// ============================================
function crearReloj() {
    const relojExistente = document.getElementById('reloj-partida');
    if (relojExistente) {
        relojExistente.remove();
    }
    
    elementoReloj = document.createElement('div');
    elementoReloj.id = 'reloj-partida';
    elementoReloj.className = 'reloj-partida';
    elementoReloj.innerHTML = '⏰ 05:00';
    document.body.appendChild(elementoReloj);
}

function actualizarReloj(segundos) {
    if (!elementoReloj) return;
    
    tiempoRestante = segundos;
    const minutos = Math.floor(segundos / 60);
    const segs = segundos % 60;
    const tiempoFormateado = `${minutos.toString().padStart(2, '0')}:${segs.toString().padStart(2, '0')}`;
    
    elementoReloj.innerHTML = `⏰ ${tiempoFormateado}`;
    
    if (segundos <= 60) {
        elementoReloj.style.background = 'linear-gradient(45deg, #ff3366, #ff0066)';
        elementoReloj.style.boxShadow = '0 0 30px rgba(255, 51, 102, 0.7)';
    } else if (segundos <= 30) {
        elementoReloj.style.background = 'linear-gradient(45deg, #ff0000, #cc0000)';
        elementoReloj.style.animation = 'pulsar 1s infinite';
    }
}

function iniciarRelojLocal(duracion) {
    tiempoRestante = duracion;
    crearReloj();
    actualizarReloj(tiempoRestante);
}

// ============================================
// EVENTOS DE TECLADO
// ============================================
window.addEventListener('keydown', (e) => {
    teclas[e.key.toLowerCase()] = true;
    
    // Tecla M para selector de personajes
    if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        
        const juegoActivo = canvas.style.display !== 'none';
        if (juegoActivo && jugadorActual && !jugadorActual.estaMuerto) {
            toggleSelectorPersonajes();
        } else if (!juegoActivo) {
            mostrarNotificacion('🎭 Solo puedes cambiar personaje durante la partida', 'info');
        }
    }
    
    // ESC para cerrar selector
    if (e.key === 'Escape' && selectorPersonajesVisible) {
        toggleSelectorPersonajes();
    }
    
    // Tecla R para recargar
    if (e.key.toLowerCase() === 'r' && jugadorActual && !jugadorActual.estaMuerto) {
        if (jugadorActual.balas < 30) {
            socket.emit('recargar');
        }
    }
});

window.addEventListener('keyup', (e) => {
    teclas[e.key.toLowerCase()] = false;
});

// ============================================
// EVENTOS DE MOUSE
// ============================================
canvas.addEventListener('mousemove', (e) => {
    if (!jugadorActual || !mapaActual || jugadorActual.estaMuerto) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const mundoX = mouseX + (jugadorActual.x - canvas.width/2);
    const mundoY = mouseY + (jugadorActual.y - canvas.height/2);
    
    jugadorActual.angulo = Math.atan2(
        mundoY - jugadorActual.y,
        mundoX - jugadorActual.x
    );
});

// EVENTO CLICK CORREGIDO CON COOLDOWN LOCAL
canvas.addEventListener('click', (e) => {
    e.preventDefault();
    if (!jugadorActual || jugadorActual.estaMuerto) return;
    
    if (jugadorActual.balas <= 0) {
        mostrarNotificacion('🔫 ¡Sin balas! Presiona R para recargar', 'error');
        return;
    }
    
    // COOLDOWN LOCAL PARA MEJOR RESPUESTA
    const ahora = Date.now();
    if (ahora - ultimoDisparoLocal < COOLDOWN_DISPARO) {
        const tiempoEspera = COOLDOWN_DISPARO - (ahora - ultimoDisparoLocal);
        mostrarNotificacion(`⏳ Espera ${Math.ceil(tiempoEspera / 100) * 100}ms`, 'error');
        return;
    }
    ultimoDisparoLocal = ahora;
    
    socket.emit('disparar', {
        x: jugadorActual.x,
        y: jugadorActual.y,
        angulo: jugadorActual.angulo
    });
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// ============================================
// EVENTOS DE SOCKET.IO
// ============================================
socket.on('salaCreada', (data) => {
    salaActual = data;
    esCreador = data.esCreador;
    miId = socket.id;
    
    crearSalaDiv.style.display = 'none';
    mostrarSalaEspera(data);
    mostrarNotificacion(`✅ Sala creada: ${data.codigoSala}`, 'exito');
});

socket.on('unidoSala', (data) => {
    salaActual = data;
    esCreador = data.esCreador;
    miId = socket.id;
    
    unirseSalaDiv.style.display = 'none';
    mostrarSalaEspera(data);
    mostrarNotificacion(`✅ Te uniste a la sala: ${data.codigoSala}`, 'exito');
});

socket.on('actualizarSala', (data) => {
    salaActual = data;
    actualizarListaJugadores(data.jugadores, data.estadosListos);
    
    if (esCreador) {
        const todosListos = data.estadosListos.every(([_, listo]) => listo === true);
        btnIniciar.style.display = todosListos && data.jugadores.length >= 2 ? 'block' : 'none';
        
        if (todosListos && data.jugadores.length >= 2) {
            mostrarNotificacion('🎮 Todos listos! Puedes iniciar la partida', 'exito');
        }
    }
});

socket.on('partidaIniciada', (data) => {
    mapaActual = data.mapa;
    jugadores.clear();
    balas.clear();
    
    data.jugadores.forEach(j => {
        jugadores.set(j.id, j);
        if (j.id === miId) {
            jugadorActual = j;
        }
    });
    
    salaEsperaDiv.style.display = 'none';
    canvas.style.display = 'block';
    hud.style.display = 'flex';
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const duracion = data.duracion || 300;
    iniciarRelojLocal(duracion);
    
    mostrarNotificacion('🎮 ¡PARTIDA INICIADA!', 'exito');
    
    iniciarJuego();
});

socket.on('tiempoRestante', (data) => {
    actualizarReloj(data.tiempo);
});

// Evento para actualización masiva de jugadores
socket.on('actualizarJugadores', (jugadoresActualizados) => {
    jugadoresActualizados.forEach(data => {
        const jugador = jugadores.get(data.id);
        if (jugador) {
            jugador.x = data.x;
            jugador.y = data.y;
            jugador.angulo = data.angulo;
            jugador.vida = data.vida;
            jugador.personaje = data.personaje;
        }
    });
});

socket.on('nuevoDisparo', (bala) => {
    balas.set(bala.id, {
        ...bala,
        vida: 100
    });
});

socket.on('actualizarBalas', (data) => {
    balas.clear();
    if (data.balas) {
        data.balas.forEach(bala => {
            balas.set(bala.id, {
                ...bala,
                vida: 100
            });
        });
    }
});

socket.on('actualizarBalasJugador', (data) => {
    if (data.id === miId && jugadorActual) {
        jugadorActual.balas = data.balas;
        balasJugadorSpan.textContent = data.balas;
    }
});

socket.on('jugadorDanado', (data) => {
    const jugador = jugadores.get(data.id);
    if (jugador) {
        jugador.vida = data.vida;
        if (data.id === miId) {
            vidaJugadorSpan.textContent = data.vida;
            if (data.vida <= 30) {
                mostrarNotificacion('❤️ ¡Cuidado! Vida baja', 'error');
            }
        }
    }
});

socket.on('jugadorMuerto', (data) => {
    const jugador = jugadores.get(data.victima);
    if (jugador) {
        jugador.estaMuerto = true;
        jugador.vida = 0;
    }
    
    if (data.victima === miId) {
        jugadorActual.estaMuerto = true;
        jugadorActual.vida = 0;
        tiempoRespawn = data.tiempoRespawn;
        
        mostrarMensajeMuerte(tiempoRespawn);
        
        if (intervaloRespawn) clearInterval(intervaloRespawn);
        let tiempoRestante = tiempoRespawn;
        intervaloRespawn = setInterval(() => {
            tiempoRestante--;
            if (tiempoRestante <= 0) {
                clearInterval(intervaloRespawn);
            }
            actualizarMensajeMuerte(tiempoRestante);
        }, 1000);
        
    } else if (data.asesino === miId) {
        mostrarNotificacion(`🎯 Eliminaste a ${data.victimaNombre}`, 'exito');
        if (jugadorActual) {
            jugadorActual.puntuacion = data.puntuacionAsesino;
            puntuacionJugadorSpan.textContent = jugadorActual.puntuacion;
        }
    } else {
        mostrarNotificacion(`💀 ${data.victimaNombre} fue eliminado por ${data.asesinoNombre}`, 'info');
    }
});

socket.on('jugadorRespawn', (data) => {
    const jugador = jugadores.get(data.id);
    if (jugador) {
        jugador.x = data.x;
        jugador.y = data.y;
        jugador.vida = data.vida;
        jugador.balas = data.balas;
        jugador.estaMuerto = false;
    }
    
    if (data.id === miId) {
        jugadorActual.x = data.x;
        jugadorActual.y = data.y;
        jugadorActual.vida = data.vida;
        jugadorActual.balas = data.balas;
        jugadorActual.estaMuerto = false;
        
        vidaJugadorSpan.textContent = data.vida;
        balasJugadorSpan.textContent = data.balas;
        
        mostrarNotificacion('✨ ¡Has respawneado!', 'exito');
        
        const mensajeMuerte = document.getElementById('mensaje-muerte');
        if (mensajeMuerte) {
            mensajeMuerte.remove();
        }
        
        if (intervaloRespawn) {
            clearInterval(intervaloRespawn);
            intervaloRespawn = null;
        }
    }
});

socket.on('personajeCambiado', (data) => {
    const jugador = jugadores.get(data.id);
    if (jugador) {
        jugador.personaje = data.personaje;
    }
    
    if (data.id === miId && jugadorActual) {
        jugadorActual.personaje = data.personaje;
    }
});

socket.on('recargaCompleta', (data) => {
    if (jugadorActual) {
        jugadorActual.balas = data.balas;
        balasJugadorSpan.textContent = data.balas;
        mostrarNotificacion('🔫 Recarga completa!', 'exito');
    }
});

socket.on('jugadorDesconectado', (data) => {
    const jugador = jugadores.get(data.id);
    if (jugador) {
        mostrarNotificacion(`👋 ${jugador.nombre} abandonó la partida`, 'info');
        jugadores.delete(data.id);
    }
});

socket.on('error', (mensaje) => {
    mostrarNotificacion(mensaje, 'error');
});

socket.on('notificacion', (data) => {
    mostrarNotificacion(data.mensaje, data.tipo);
});

socket.on('finPartida', (data) => {
    if (data.razon === 'tiempo') {
        mostrarNotificacion('⏰ ¡TIEMPO TERMINADO!', 'info');
    }
    
    canvas.style.display = 'none';
    hud.style.display = 'none';
    
    const reloj = document.getElementById('reloj-partida');
    if (reloj) {
        reloj.remove();
    }
    
    const mensajeMuerte = document.getElementById('mensaje-muerte');
    if (mensajeMuerte) {
        mensajeMuerte.remove();
    }
    
    mostrarLeaderboard(data.jugadores);
});

// ============================================
// FUNCIONES DE LA SALA DE ESPERA
// ============================================
function mostrarSalaEspera(data) {
    salaNombre.textContent = data.nombreSala;
    salaCodigo.textContent = data.codigoSala;
    salaEsperaDiv.style.display = 'block';
    
    actualizarListaJugadores(data.jugadores, data.estadosListos || []);
    btnListo.disabled = false;
    btnListo.textContent = '✅ LISTO';
    btnIniciar.style.display = 'none';
}

function actualizarListaJugadores(jugadores, estadosListos) {
    listaJugadores.innerHTML = '';
    
    jugadores.forEach(jugador => {
        const li = document.createElement('li');
        
        const estadoListo = estadosListos.find(([id, _]) => id === jugador.id);
        const listo = estadoListo ? estadoListo[1] : false;
        
        li.innerHTML = `
            <span>
                👤 ${jugador.nombre}
                ${jugador.id === salaActual?.creador ? '<span class="creador-badge">👑 CREADOR</span>' : ''}
                ${jugador.id === miId ? ' (TÚ)' : ''}
            </span>
            <span class="${listo ? 'jugador-listo' : 'jugador-no-listo'}">
                ${listo ? '✅ LISTO' : '⏳ ESPERANDO'}
            </span>
        `;
        
        listaJugadores.appendChild(li);
    });
    
    contadorJugadores.textContent = `👥 ${jugadores.length}/${salaActual?.maxJugadores || 10} jugadores`;
}

// ============================================
// FUNCIONES DE MENSAJE DE MUERTE
// ============================================
function mostrarMensajeMuerte(tiempo) {
    const mensajeExistente = document.getElementById('mensaje-muerte');
    if (mensajeExistente) {
        mensajeExistente.remove();
    }
    
    const mensajeDiv = document.createElement('div');
    mensajeDiv.id = 'mensaje-muerte';
    mensajeDiv.className = 'mensaje-muerte';
    
    mensajeDiv.innerHTML = `
        <h2>💀 HAS MUERTO</h2>
        <p>Respawneando en...</p>
        <div class="contador" id="contador-muerte">${tiempo}</div>
        <p class="small">segundos</p>
    `;
    
    document.body.appendChild(mensajeDiv);
}

function actualizarMensajeMuerte(tiempo) {
    const contador = document.getElementById('contador-muerte');
    if (contador) {
        contador.textContent = tiempo;
    }
}

// ============================================
// FUNCIONES DEL JUEGO
// ============================================
function iniciarJuego() {
    function gameLoop() {
        if (!jugadorActual || !mapaActual) {
            animacionFrame = requestAnimationFrame(gameLoop);
            return;
        }
        
        if (!jugadorActual.estaMuerto) {
            let dx = 0, dy = 0;
            if (teclas['w']) dy -= velocidadMovimiento;
            if (teclas['s']) dy += velocidadMovimiento;
            if (teclas['a']) dx -= velocidadMovimiento;
            if (teclas['d']) dx += velocidadMovimiento;
            
            if (dx !== 0 || dy !== 0) {
                if (dx !== 0 && dy !== 0) {
                    dx *= 0.707;
                    dy *= 0.707;
                }
                
                const nuevaX = jugadorActual.x + dx;
                const nuevaY = jugadorActual.y + dy;
                
                let puedeMoverse = true;
                
                for (let obs of mapaActual.obstaculos) {
                    if (nuevaX > obs.x - 25 && nuevaX < obs.x + obs.ancho + 25 &&
                        nuevaY > obs.y - 25 && nuevaY < obs.y + obs.alto + 25) {
                        puedeMoverse = false;
                        break;
                    }
                }
                
                if (nuevaX < 25 || nuevaX > mapaActual.ancho - 25 ||
                    nuevaY < 25 || nuevaY > mapaActual.alto - 25) {
                    puedeMoverse = false;
                }
                
                if (puedeMoverse) {
                    jugadorActual.x = nuevaX;
                    jugadorActual.y = nuevaY;
                    
                    socket.emit('moverJugador', {
                        x: jugadorActual.x,
                        y: jugadorActual.y,
                        angulo: jugadorActual.angulo
                    });
                }
            }
        }
        
        if (jugadorActual) {
            vidaJugadorSpan.textContent = Math.max(0, jugadorActual.vida);
            balasJugadorSpan.textContent = jugadorActual.balas;
            puntuacionJugadorSpan.textContent = jugadorActual.puntuacion;
        }
        
        dibujar();
        
        animacionFrame = requestAnimationFrame(gameLoop);
    }
    
    gameLoop();
}

function dibujar() {
    if (!mapaActual || !jugadorActual) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const camaraX = jugadorActual.x - canvas.width/2;
    const camaraY = jugadorActual.y - canvas.height/2;
    
    const gradiente = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradiente.addColorStop(0, '#1e1e2e');
    gradiente.addColorStop(1, '#2d2d3a');
    ctx.fillStyle = gradiente;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!gridPattern) {
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = 50;
        patternCanvas.height = 50;
        const patternCtx = patternCanvas.getContext('2d');
        
        patternCtx.strokeStyle = '#3a3a4a';
        patternCtx.lineWidth = 1;
        patternCtx.beginPath();
        patternCtx.moveTo(0, 0);
        patternCtx.lineTo(50, 0);
        patternCtx.moveTo(0, 0);
        patternCtx.lineTo(0, 50);
        patternCtx.stroke();
        
        gridPattern = ctx.createPattern(patternCanvas, 'repeat');
    }
    
    ctx.fillStyle = gridPattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    mapaActual.obstaculos.forEach(obs => {
        const x = obs.x - camaraX;
        const y = obs.y - camaraY;
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        ctx.fillStyle = '#654321';
        ctx.fillRect(x, y, obs.ancho, obs.alto);
        
        ctx.strokeStyle = '#8b5a2b';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, obs.ancho, obs.alto);
        
        ctx.fillStyle = '#8b5a2b';
        for (let i = 0; i < obs.ancho; i += 30) {
            for (let j = 0; j < obs.alto; j += 30) {
                ctx.fillRect(x + i + 10, y + j + 10, 5, 5);
            }
        }
    });
    
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    balas.forEach(bala => {
        const x = bala.x - camaraX;
        const y = bala.y - camaraY;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(bala.angulo);
        
        ctx.fillStyle = '#ffff00';
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 15;
        ctx.fillRect(-3, -2, 12, 4);
        
        ctx.fillStyle = '#ffaa00';
        ctx.shadowBlur = 20;
        ctx.fillRect(-10, -1, 7, 2);
        
        ctx.restore();
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffff00';
        ctx.shadowBlur = 20;
        ctx.fill();
    });
    
    ctx.shadowBlur = 0;
    
    jugadores.forEach(jugador => {
        if (jugador.estaMuerto) return;
        
        const x = jugador.x - camaraX;
        const y = jugador.y - camaraY;
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        const imgPersonaje = imagenesPersonajes[jugador.personaje || 1];
        if (imgPersonaje && imgPersonaje.complete) {
            ctx.drawImage(imgPersonaje, x - 25, y - 25, 50, 50);
        } else {
            ctx.beginPath();
            ctx.arc(x, y, 22, 0, Math.PI * 2);
            
            if (jugador.id === miId) {
                const gradiente = ctx.createRadialGradient(x-8, y-8, 5, x, y, 30);
                gradiente.addColorStop(0, '#00ff00');
                gradiente.addColorStop(0.7, '#00aa00');
                gradiente.addColorStop(1, '#006600');
                ctx.fillStyle = gradiente;
            } else {
                const gradiente = ctx.createRadialGradient(x-8, y-8, 5, x, y, 30);
                gradiente.addColorStop(0, '#ff4444');
                gradiente.addColorStop(0.7, '#aa0000');
                gradiente.addColorStop(1, '#660000');
                ctx.fillStyle = gradiente;
            }
            
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        const vidaPorcentaje = Math.max(0, jugador.vida) / 100;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(x - 30, y - 45, 60, 8);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(x - 30, y - 45, 60 * vidaPorcentaje, 8);
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 30, y - 45, 60, 8);
        
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(jugador.nombre, x, y - 55);
        
        ctx.font = '12px Arial';
        ctx.fillStyle = '#ffff00';
        ctx.fillText(`🏆 ${jugador.puntuacion}`, x, y - 70);
        
        if (jugador.id === miId) {
            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = '#00ffff';
            ctx.fillText('👤 TÚ', x, y - 85);
        }
        
        if (jugador.id === miId && jugador.balas < 30 && !jugador.estaMuerto) {
            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = '#ffff00';
            ctx.fillText(`🔫 ${jugador.balas}`, x, y + 45);
        }
        
        if (!jugador.estaMuerto) {
            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 10;
            
            const longitudArma = 35;
            const lineaX = x + Math.cos(jugador.angulo) * longitudArma;
            const lineaY = y + Math.sin(jugador.angulo) * longitudArma;
            
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(lineaX, lineaY);
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 5;
            ctx.stroke();
            
            ctx.beginPath();
            ctx.arc(lineaX, lineaY, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffaa00';
            ctx.fill();
        }
        
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
    });
}

// ============================================
// LEADERBOARD
// ============================================
function mostrarLeaderboard(jugadoresArray) {
    const leaderboardExistente = document.querySelector('.leaderboard');
    if (leaderboardExistente) {
        leaderboardExistente.remove();
    }
    
    const leaderboardDiv = document.createElement('div');
    leaderboardDiv.className = 'menu leaderboard';
    
    const ganador = jugadoresArray[0];
    
    leaderboardDiv.innerHTML = `
        <h2>🏆 RESULTADOS FINALES</h2>
        <div class="ganador-destacado">
            <div class="trofeo">🏆</div>
            <h3>${ganador.nombre} ${ganador.id === miId ? '(TÚ)' : ''}</h3>
            <p>¡CAMPEÓN!</p>
            <p class="estadisticas-ganador">${ganador.puntuacion} KILLS</p>
        </div>
        <div class="jugadores-lista">
            <ul>
                ${jugadoresArray.map((j, i) => `
                    <li class="${i === 0 ? 'primer-lugar' : i === 1 ? 'segundo-lugar' : i === 2 ? 'tercer-lugar' : ''}">
                        <span>
                            ${i+1}. ${j.nombre} ${j.id === miId ? '(TÚ)' : ''}
                        </span>
                        <span class="puntuacion">
                            🎯 ${j.puntuacion} kill${j.puntuacion !== 1 ? 's' : ''} 
                            | 💀 ${j.muertes || 0} muerte${j.muertes !== 1 ? 's' : ''}
                        </span>
                    </li>
                `).join('')}
            </ul>
        </div>
        <button class="btn" onclick="location.reload()">🔄 VOLVER AL MENÚ</button>
    `;
    
    document.body.appendChild(leaderboardDiv);
}

// ============================================
// EVENTOS DE VENTANA
// ============================================
window.addEventListener('resize', () => {
    if (canvas.style.display !== 'none') {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
});

window.addEventListener('beforeunload', () => {
    if (animacionFrame) {
        cancelAnimationFrame(animacionFrame);
    }
    if (intervaloRespawn) {
        clearInterval(intervaloRespawn);
    }
    if (intervaloReloj) {
        clearInterval(intervaloReloj);
    }
});

console.log('🎮 Juego cargado correctamente');