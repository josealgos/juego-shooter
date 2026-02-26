const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(__dirname));

// Estructuras de datos del servidor
const salas = new Map(); // Map(salaId => {info sala})
const jugadores = new Map(); // Map(socketId => {info jugador})
const salasPorJugador = new Map(); // Map(socketId => salaId)

// ============================================
// CLASE QUADTREE PARA OPTIMIZACIÓN DE COLISIONES
// ============================================
class Quadtree {
    constructor(x, y, ancho, alto, nivel = 0, maxNivel = 5, maxObjetos = 10) {
        this.x = x;
        this.y = y;
        this.ancho = ancho;
        this.alto = alto;
        this.nivel = nivel;
        this.maxNivel = maxNivel;
        this.maxObjetos = maxObjetos;
        this.objetos = [];
        this.nodos = [];
    }
    
    limpiar() {
        this.objetos = [];
        for (let nodo of this.nodos) {
            nodo.limpiar();
        }
        this.nodos = [];
    }
    
    dividir() {
        const subAncho = this.ancho / 2;
        const subAlto = this.alto / 2;
        const x = this.x;
        const y = this.y;
        const nuevoNivel = this.nivel + 1;
        
        this.nodos = [
            new Quadtree(x + subAncho, y, subAncho, subAlto, nuevoNivel, this.maxNivel, this.maxObjetos),
            new Quadtree(x, y, subAncho, subAlto, nuevoNivel, this.maxNivel, this.maxObjetos),
            new Quadtree(x, y + subAlto, subAncho, subAlto, nuevoNivel, this.maxNivel, this.maxObjetos),
            new Quadtree(x + subAncho, y + subAlto, subAncho, subAlto, nuevoNivel, this.maxNivel, this.maxObjetos)
        ];
    }
    
    obtenerIndice(objeto) {
        const puntoMedioX = this.x + this.ancho / 2;
        const puntoMedioY = this.y + this.alto / 2;
        
        const arriba = objeto.y < puntoMedioY;
        const abajo = objeto.y > puntoMedioY;
        
        if (objeto.x < puntoMedioX) {
            if (arriba) return 1;
            if (abajo) return 2;
        } else if (objeto.x > puntoMedioX) {
            if (arriba) return 0;
            if (abajo) return 3;
        }
        
        return -1;
    }
    
    insertar(objeto) {
        if (this.nodos.length > 0) {
            const indice = this.obtenerIndice(objeto);
            if (indice !== -1) {
                this.nodos[indice].insertar(objeto);
                return;
            }
        }
        
        this.objetos.push(objeto);
        
        if (this.objetos.length > this.maxObjetos && this.nivel < this.maxNivel) {
            if (this.nodos.length === 0) {
                this.dividir();
            }
            
            let i = 0;
            while (i < this.objetos.length) {
                const indice = this.obtenerIndice(this.objetos[i]);
                if (indice !== -1) {
                    this.nodos[indice].insertar(this.objetos.splice(i, 1)[0]);
                } else {
                    i++;
                }
            }
        }
    }
    
    recuperar(objeto, objetosEncontrados = []) {
        const indice = this.obtenerIndice(objeto);
        if (indice !== -1 && this.nodos.length > 0) {
            this.nodos[indice].recuperar(objeto, objetosEncontrados);
        }
        
        objetosEncontrados.push(...this.objetos);
        
        return objetosEncontrados;
    }
}

// ============================================
// CLASE BALA POOL PARA REUTILIZAR OBJETOS
// ============================================
class BalaPool {
    constructor() {
        this.pool = [];
        this.tamanoMaximo = 500;
    }
    
    obtenerBala(jugadorId, x, y, dx, dy, angulo) {
        if (this.pool.length > 0) {
            const bala = this.pool.pop();
            bala.id = Math.random().toString(36).substring(7);
            bala.jugadorId = jugadorId;
            bala.x = x;
            bala.y = y;
            bala.dx = dx;
            bala.dy = dy;
            bala.angulo = angulo;
            bala.distanciaRecorrida = 0;
            bala.distanciaMaxima = 800;
            return bala;
        }
        
        return {
            id: Math.random().toString(36).substring(7),
            jugadorId: jugadorId,
            x: x,
            y: y,
            dx: dx,
            dy: dy,
            angulo: angulo,
            distanciaRecorrida: 0,
            distanciaMaxima: 800
        };
    }
    
    devolverBala(bala) {
        if (this.pool.length < this.tamanoMaximo) {
            this.pool.push(bala);
        }
    }
}

const balaPool = new BalaPool();

// ============================================
// CLASE SALA
// ============================================
class Sala {
    constructor(id, nombre, maxJugadores, creadorId) {
        this.id = id;
        this.nombre = nombre;
        this.maxJugadores = maxJugadores;
        this.creadorId = creadorId;
        this.jugadores = new Map(); // Map(socketId => {info})
        this.estadosListos = new Map(); // Map(socketId => boolean)
        this.juegoIniciado = false;
        this.mapa = this.generarMapa();
        this.balas = [];
        this.jugadoresRespawn = new Map(); // Map(socketId => {tiempoRespawn, timeout})
        
        // Para cooldown de disparo
        this.ultimoDisparo = new Map(); // Map(socketId => timestamp)
        
        // Quadtree para optimización de colisiones
        this.quadtree = new Quadtree(0, 0, 2000, 2000);
        
        // Propiedades para el temporizador
        this.tiempoInicio = null;
        this.temporizador = null;
        this.duracionPartida = 300; // 5 minutos en segundos
        this.tiempoRestante = this.duracionPartida;
    }

    generarMapa() {
        return {
            ancho: 2000,
            alto: 2000,
            obstaculos: [
                { x: 0, y: 0, ancho: 2000, alto: 20 },
                { x: 0, y: 0, ancho: 20, alto: 2000 },
                { x: 1980, y: 0, ancho: 20, alto: 2000 },
                { x: 0, y: 1980, ancho: 2000, alto: 20 },
                { x: 400, y: 400, ancho: 100, alto: 100 },
                { x: 800, y: 600, ancho: 150, alto: 80 },
                { x: 1200, y: 300, ancho: 80, alto: 150 },
                { x: 600, y: 1200, ancho: 200, alto: 50 },
                { x: 1400, y: 1400, ancho: 100, alto: 100 },
                { x: 300, y: 1600, ancho: 120, alto: 80 },
                { x: 1600, y: 800, ancho: 150, alto: 150 },
                { x: 200, y: 800, ancho: 100, alto: 200 }
            ]
        };
    }

    generarPosicionValida() {
        let intentos = 0;
        let posX, posY;
        let valida = false;
        
        while (!valida && intentos < 100) {
            posX = Math.random() * 1800 + 100;
            posY = Math.random() * 1800 + 100;
            valida = true;
            
            for (let obs of this.mapa.obstaculos) {
                if (posX > obs.x - 30 && posX < obs.x + obs.ancho + 30 &&
                    posY > obs.y - 30 && posY < obs.y + obs.alto + 30) {
                    valida = false;
                    break;
                }
            }
            intentos++;
        }
        
        return { x: posX, y: posY };
    }

    agregarJugador(socketId, nombreJugador) {
        if (this.jugadores.size >= this.maxJugadores) return false;
        
        const personaje = Math.floor(Math.random() * 3) + 1;
        const posicion = this.generarPosicionValida();
        
        this.jugadores.set(socketId, {
            id: socketId,
            nombre: nombreJugador,
            personaje: personaje,
            x: posicion.x,
            y: posicion.y,
            angulo: 0,
            vida: 100,
            balas: 30,
            puntuacion: 0,
            muertes: 0,
            estaMuerto: false,
            tiempoRespawn: 0
        });
        
        this.estadosListos.set(socketId, false);
        return true;
    }

    eliminarJugador(socketId) {
        if (this.jugadoresRespawn.has(socketId)) {
            clearTimeout(this.jugadoresRespawn.get(socketId).timeout);
            this.jugadoresRespawn.delete(socketId);
        }
        
        // Limpiar cooldown de disparo
        this.ultimoDisparo.delete(socketId);
        
        this.jugadores.delete(socketId);
        this.estadosListos.delete(socketId);
        
        if (this.creadorId === socketId && this.jugadores.size > 0) {
            this.creadorId = Array.from(this.jugadores.keys())[0];
        }
    }

    toggleListo(socketId) {
        if (this.jugadores.has(socketId)) {
            const estadoActual = this.estadosListos.get(socketId);
            this.estadosListos.set(socketId, !estadoActual);
            return true;
        }
        return false;
    }

    todosListos() {
        if (this.jugadores.size < 2) return false;
        
        for (let [id, _] of this.jugadores) {
            if (!this.estadosListos.get(id)) return false;
        }
        return true;
    }

    iniciarJuego() {
        this.juegoIniciado = true;
        this.balas = [];
        this.jugadoresRespawn.clear();
        this.ultimoDisparo.clear(); // Limpiar cooldowns al iniciar
        
        // Inicializar el temporizador
        this.tiempoInicio = Date.now();
        this.tiempoRestante = this.duracionPartida;
        
        // Reiniciar estadísticas de todos los jugadores
        for (let [id, jugador] of this.jugadores) {
            const posicion = this.generarPosicionValida();
            jugador.x = posicion.x;
            jugador.y = posicion.y;
            jugador.vida = 100;
            jugador.balas = 30;
            jugador.puntuacion = 0;
            jugador.muertes = 0;
            jugador.estaMuerto = false;
            jugador.tiempoRespawn = 0;
        }
        
        // Iniciar el contador regresivo
        this.iniciarTemporizador();
    }
    
    iniciarTemporizador() {
        if (this.temporizador) {
            clearInterval(this.temporizador);
        }
        
        this.temporizador = setInterval(() => {
            if (!this.juegoIniciado) {
                clearInterval(this.temporizador);
                return;
            }
            
            const tiempoTranscurrido = Math.floor((Date.now() - this.tiempoInicio) / 1000);
            this.tiempoRestante = Math.max(0, this.duracionPartida - tiempoTranscurrido);
            
            io.to(this.id).emit('tiempoRestante', {
                tiempo: this.tiempoRestante
            });
            
            if (this.tiempoRestante <= 0) {
                this.terminarPartidaPorTiempo();
            }
        }, 1000);
    }
    
    terminarPartidaPorTiempo() {
        if (!this.juegoIniciado) return;
        
        if (this.temporizador) {
            clearInterval(this.temporizador);
            this.temporizador = null;
        }
        
        this.juegoIniciado = false;
        
        const jugadoresArray = Array.from(this.jugadores.values()).map(j => ({
            id: j.id,
            nombre: j.nombre,
            puntuacion: j.puntuacion,
            muertes: j.muertes,
            personaje: j.personaje
        }));
        
        jugadoresArray.sort((a, b) => b.puntuacion - a.puntuacion);
        
        io.to(this.id).emit('finPartida', {
            jugadores: jugadoresArray,
            razon: 'tiempo',
            mensaje: '⏰ ¡TIEMPO TERMINADO!'
        });
        
        console.log(`⏰ Partida terminada por tiempo en sala ${this.id}`);
    }

    manejarMuerte(jugadorId, asesinoId) {
        const jugador = this.jugadores.get(jugadorId);
        const asesino = this.jugadores.get(asesinoId);
        
        if (!jugador) return;
        
        jugador.estaMuerto = true;
        jugador.vida = 0;
        jugador.muertes++;
        
        // Limpiar cooldown al morir
        this.ultimoDisparo.delete(jugadorId);
        
        if (asesino) {
            asesino.puntuacion++;
        }
        
        const tiempoRespawn = 5;
        jugador.tiempoRespawn = tiempoRespawn;
        
        const timeout = setTimeout(() => {
            this.revivirJugador(jugadorId);
        }, tiempoRespawn * 1000);
        
        this.jugadoresRespawn.set(jugadorId, {
            tiempoRespawn: tiempoRespawn,
            timeout: timeout
        });
        
        io.to(this.id).emit('jugadorMuerto', {
            asesino: asesinoId,
            asesinoNombre: asesino ? asesino.nombre : 'Desconocido',
            victima: jugadorId,
            victimaNombre: jugador.nombre,
            puntuacionAsesino: asesino ? asesino.puntuacion : 0,
            tiempoRespawn: tiempoRespawn
        });
    }

    revivirJugador(jugadorId) {
        const jugador = this.jugadores.get(jugadorId);
        if (!jugador) return;
        
        const posicion = this.generarPosicionValida();
        
        jugador.estaMuerto = false;
        jugador.vida = 100;
        jugador.balas = 30;
        jugador.x = posicion.x;
        jugador.y = posicion.y;
        jugador.tiempoRespawn = 0;
        
        // Limpiar cooldown al revivir
        this.ultimoDisparo.delete(jugadorId);
        
        this.jugadoresRespawn.delete(jugadorId);
        
        io.to(this.id).emit('jugadorRespawn', {
            id: jugadorId,
            x: jugador.x,
            y: jugador.y,
            vida: jugador.vida,
            balas: jugador.balas,
            nombre: jugador.nombre
        });
    }

    cambiarPersonaje(jugadorId, nuevoPersonaje) {
        const jugador = this.jugadores.get(jugadorId);
        if (!jugador) return false;
        
        if (nuevoPersonaje >= 1 && nuevoPersonaje <= 3) {
            jugador.personaje = nuevoPersonaje;
            return true;
        }
        return false;
    }

    verificarFinPartida() {
        return false;
    }
    
    limpiarRecursos() {
        if (this.temporizador) {
            clearInterval(this.temporizador);
            this.temporizador = null;
        }
        
        for (let [id, data] of this.jugadoresRespawn) {
            if (data.timeout) {
                clearTimeout(data.timeout);
            }
        }
        this.jugadoresRespawn.clear();
        this.ultimoDisparo.clear();
    }
}

// ============================================
// CONFIGURACIÓN DE OPTIMIZACIÓN DE RED
// ============================================
const FRECUENCIA_ACTUALIZACION = 33; // ~30fps

// ============================================
// EVENTOS DE SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('🎮 Jugador conectado:', socket.id);

    socket.on('crearSala', ({ nombreSala, maxJugadores, nombreJugador }) => {
        try {
            const codigoSala = Math.random().toString(36).substring(2, 8).toUpperCase();
            
            const nuevaSala = new Sala(codigoSala, nombreSala, maxJugadores, socket.id);
            nuevaSala.agregarJugador(socket.id, nombreJugador);
            
            salas.set(codigoSala, nuevaSala);
            salasPorJugador.set(socket.id, codigoSala);
            
            socket.join(codigoSala);
            
            socket.emit('salaCreada', {
                codigoSala,
                nombreSala,
                maxJugadores,
                jugadores: Array.from(nuevaSala.jugadores.values()),
                esCreador: true
            });
            
            console.log(`✅ Sala creada: ${codigoSala} - ${nombreSala}`);
            
        } catch (error) {
            console.error('Error al crear sala:', error);
            socket.emit('error', 'Error al crear la sala');
        }
    });

    socket.on('unirseSala', ({ codigoSala, nombreJugador }) => {
        const sala = salas.get(codigoSala);
        
        if (!sala) {
            socket.emit('error', '❌ Sala no encontrada');
            return;
        }
        
        if (sala.juegoIniciado) {
            socket.emit('error', '❌ La partida ya comenzó');
            return;
        }
        
        if (sala.jugadores.size >= sala.maxJugadores) {
            socket.emit('error', '❌ Sala llena');
            return;
        }
        
        if (sala.agregarJugador(socket.id, nombreJugador)) {
            salasPorJugador.set(socket.id, codigoSala);
            socket.join(codigoSala);
            
            io.to(codigoSala).emit('actualizarSala', {
                nombreSala: sala.nombre,
                codigoSala: sala.id,
                jugadores: Array.from(sala.jugadores.values()),
                estadosListos: Array.from(sala.estadosListos.entries()),
                esCreador: socket.id === sala.creadorId
            });
            
            socket.emit('unidoSala', {
                nombreSala: sala.nombre,
                codigoSala: sala.id,
                jugadores: Array.from(sala.jugadores.values()),
                esCreador: socket.id === sala.creadorId
            });
            
            console.log(`👤 ${nombreJugador} se unió a sala ${codigoSala}`);
        }
    });

    socket.on('marcarListo', () => {
        const salaId = salasPorJugador.get(socket.id);
        if (!salaId) return;
        
        const sala = salas.get(salaId);
        if (!sala || sala.juegoIniciado) return;
        
        sala.toggleListo(socket.id);
        
        io.to(salaId).emit('actualizarSala', {
            nombreSala: sala.nombre,
            codigoSala: sala.id,
            jugadores: Array.from(sala.jugadores.values()),
            estadosListos: Array.from(sala.estadosListos.entries()),
            esCreador: socket.id === sala.creadorId
        });
    });

    socket.on('iniciarPartida', () => {
        const salaId = salasPorJugador.get(socket.id);
        if (!salaId) return;
        
        const sala = salas.get(salaId);
        if (!sala || sala.creadorId !== socket.id) return;
        
        if (sala.todosListos()) {
            sala.iniciarJuego();
            
            io.to(salaId).emit('partidaIniciada', {
                mapa: sala.mapa,
                jugadores: Array.from(sala.jugadores.values()),
                duracion: sala.duracionPartida
            });
            
            console.log(`🎮 Partida iniciada en sala ${salaId} - Duración: ${sala.duracionPartida/60} minutos`);
        }
    });

    socket.on('moverJugador', (datosMovimiento) => {
        const salaId = salasPorJugador.get(socket.id);
        if (!salaId) return;
        
        const sala = salas.get(salaId);
        if (!sala || !sala.juegoIniciado) return;
        
        const jugador = sala.jugadores.get(socket.id);
        if (!jugador || jugador.estaMuerto) return;
        
        // ANTI-CHEAT: Validar que el movimiento sea razonable (ajustado a 30px)
        const distancia = Math.hypot(datosMovimiento.x - jugador.x, datosMovimiento.y - jugador.y);
        if (distancia > 30) {
            console.warn(`🚫 Posible cheat: ${jugador.nombre} intentó moverse ${distancia.toFixed(2)}px`);
            return;
        }
        
        jugador.x = datosMovimiento.x;
        jugador.y = datosMovimiento.y;
        jugador.angulo = datosMovimiento.angulo;
    });

    socket.on('disparar', ({ x, y, angulo }) => {
        const salaId = salasPorJugador.get(socket.id);
        if (!salaId) return;
        
        const sala = salas.get(salaId);
        if (!sala || !sala.juegoIniciado) return;
        
        const jugador = sala.jugadores.get(socket.id);
        if (!jugador || jugador.estaMuerto || jugador.balas <= 0) {
            socket.emit('notificacion', {
                tipo: 'error',
                mensaje: '❌ No puedes disparar ahora'
            });
            return;
        }
        
        // COOLDOWN DE DISPARO (300ms) - CORREGIDO
        const ahora = Date.now();
        const ultimo = sala.ultimoDisparo.get(socket.id) || 0;
        
        if (ahora - ultimo < 300) {
            const tiempoEspera = 300 - (ahora - ultimo);
            socket.emit('notificacion', {
                tipo: 'error',
                mensaje: `⏳ Espera ${Math.ceil(tiempoEspera / 100) * 100}ms para disparar`
            });
            return;
        }
        
        // Actualizar timestamp de último disparo
        sala.ultimoDisparo.set(socket.id, ahora);
        
        jugador.balas--;
        
        const velocidadBala = 15;
        const dx = Math.cos(angulo) * velocidadBala;
        const dy = Math.sin(angulo) * velocidadBala;
        
        // Usar el pool de balas
        const bala = balaPool.obtenerBala(socket.id, x, y, dx, dy, angulo);
        
        sala.balas.push(bala);
        
        io.to(salaId).emit('nuevoDisparo', bala);
        
        io.to(salaId).emit('actualizarBalasJugador', {
            id: socket.id,
            balas: jugador.balas
        });
    });

    socket.on('recargar', () => {
        const salaId = salasPorJugador.get(socket.id);
        if (!salaId) return;
        
        const sala = salas.get(salaId);
        if (!sala || !sala.juegoIniciado) return;
        
        const jugador = sala.jugadores.get(socket.id);
        if (!jugador || jugador.estaMuerto) return;
        
        jugador.balas = 30;
        socket.emit('recargaCompleta', { balas: 30 });
    });

    socket.on('cambiarPersonaje', ({ personaje }) => {
        const salaId = salasPorJugador.get(socket.id);
        if (!salaId) return;
        
        const sala = salas.get(salaId);
        if (!sala) return;
        
        if (sala.cambiarPersonaje(socket.id, personaje)) {
            io.to(salaId).emit('personajeCambiado', {
                id: socket.id,
                personaje: personaje
            });
            
            socket.emit('notificacion', {
                tipo: 'exito',
                mensaje: '✅ Personaje cambiado exitosamente'
            });
        }
    });

    socket.on('disconnect', () => {
        const salaId = salasPorJugador.get(socket.id);
        if (salaId) {
            const sala = salas.get(salaId);
            if (sala) {
                const jugador = sala.jugadores.get(socket.id);
                const nombreJugador = jugador ? jugador.nombre : 'Desconocido';
                
                sala.eliminarJugador(socket.id);
                
                if (sala.jugadores.size === 0) {
                    sala.limpiarRecursos();
                    salas.delete(salaId);
                    console.log(`🗑️ Sala ${salaId} eliminada (vacía)`);
                } else {
                    io.to(salaId).emit('jugadorDesconectado', { id: socket.id });
                    io.to(salaId).emit('actualizarSala', {
                        nombreSala: sala.nombre,
                        codigoSala: sala.id,
                        jugadores: Array.from(sala.jugadores.values()),
                        estadosListos: Array.from(sala.estadosListos.entries()),
                        esCreador: false
                    });
                    
                    if (sala.juegoIniciado && sala.jugadores.size === 0) {
                        sala.limpiarRecursos();
                        salas.delete(salaId);
                    }
                }
            }
            salasPorJugador.delete(socket.id);
        }
        console.log('👋 Jugador desconectado:', socket.id);
    });
});

// ============================================
// FUNCIÓN PARA ACTUALIZAR BALAS (LOOP DE FÍSICA)
// ============================================
function actualizarBalas() {
    for (let [salaId, sala] of salas) {
        if (!sala.juegoIniciado || !sala.balas || sala.balas.length === 0) continue;
        
        // Limpiar balas de jugadores desconectados o muertos
        const balasEliminadas = [];
        sala.balas = sala.balas.filter(bala => {
            const jugador = sala.jugadores.get(bala.jugadorId);
            if (!jugador || jugador.estaMuerto) {
                balasEliminadas.push(bala);
                return false;
            }
            return true;
        });
        
        // Devolver balas eliminadas al pool
        for (let bala of balasEliminadas) {
            balaPool.devolverBala(bala);
        }
        
        if (sala.balas.length === 0) continue;
        
        // Construir quadtree con jugadores vivos para optimizar colisiones
        sala.quadtree.limpiar();
        for (let [id, jugador] of sala.jugadores) {
            if (!jugador.estaMuerto) {
                sala.quadtree.insertar({
                    id: id,
                    x: jugador.x,
                    y: jugador.y,
                    ancho: 30,
                    alto: 30
                });
            }
        }
        
        const balasActivas = [];
        
        for (let bala of sala.balas) {
            bala.x += bala.dx;
            bala.y += bala.dy;
            bala.distanciaRecorrida += Math.sqrt(bala.dx * bala.dx + bala.dy * bala.dy);
            
            if (bala.distanciaRecorrida > bala.distanciaMaxima ||
                bala.x < 0 || bala.x > sala.mapa.ancho ||
                bala.y < 0 || bala.y > sala.mapa.alto) {
                balaPool.devolverBala(bala);
                continue;
            }
            
            let impactoObstaculo = false;
            for (let obs of sala.mapa.obstaculos) {
                if (bala.x > obs.x && bala.x < obs.x + obs.ancho &&
                    bala.y > obs.y && bala.y < obs.y + obs.alto) {
                    impactoObstaculo = true;
                    break;
                }
            }
            
            if (impactoObstaculo) {
                balaPool.devolverBala(bala);
                continue;
            }
            
            // Usar quadtree para encontrar posibles jugadores cerca
            const radioBusqueda = 40;
            const posiblesJugadores = sala.quadtree.recuperar({
                x: bala.x - radioBusqueda,
                y: bala.y - radioBusqueda,
                ancho: radioBusqueda * 2,
                alto: radioBusqueda * 2
            });
            
            let impactoJugador = false;
            
            for (let posible of posiblesJugadores) {
                const jugadorId = posible.id;
                const jugador = sala.jugadores.get(jugadorId);
                
                if (!jugador || jugador.estaMuerto || jugadorId === bala.jugadorId) continue;
                
                const radioColision = 30;
                const distanciaActual = Math.hypot(bala.x - jugador.x, bala.y - jugador.y);
                
                if (distanciaActual < radioColision) {
                    impactoJugador = true;
                    
                    jugador.vida = Math.max(0, jugador.vida - 25);
                    
                    io.to(salaId).emit('jugadorDanado', {
                        id: jugadorId,
                        vida: jugador.vida,
                        atacanteId: bala.jugadorId
                    });
                    
                    if (jugador.vida <= 0 && !jugador.estaMuerto) {
                        sala.manejarMuerte(jugadorId, bala.jugadorId);
                    }
                    
                    break;
                }
                
                // Verificar si la bala atravesó al jugador
                const xAnterior = bala.x - bala.dx;
                const yAnterior = bala.y - bala.dy;
                const distanciaAnterior = Math.hypot(xAnterior - jugador.x, yAnterior - jugador.y);
                
                if (distanciaAnterior > radioColision && distanciaActual < radioColision) {
                    impactoJugador = true;
                    
                    jugador.vida = Math.max(0, jugador.vida - 25);
                    
                    io.to(salaId).emit('jugadorDanado', {
                        id: jugadorId,
                        vida: jugador.vida,
                        atacanteId: bala.jugadorId
                    });
                    
                    if (jugador.vida <= 0 && !jugador.estaMuerto) {
                        sala.manejarMuerte(jugadorId, bala.jugadorId);
                    }
                    
                    break;
                }
            }
            
            if (!impactoJugador) {
                balasActivas.push(bala);
            } else {
                balaPool.devolverBala(bala);
            }
        }
        
        sala.balas = balasActivas;
        
        io.to(salaId).emit('actualizarBalas', { balas: balasActivas });
    }
}

// ============================================
// FUNCIÓN PARA ENVIAR ACTUALIZACIONES DE POSICIONES (30fps)
// ============================================
function enviarActualizacionesPosiciones() {
    for (let [salaId, sala] of salas) {
        if (!sala.juegoIniciado) continue;
        
        const jugadoresActualizados = [];
        for (let [id, jugador] of sala.jugadores) {
            if (!jugador.estaMuerto) {
                jugadoresActualizados.push({
                    id: id,
                    x: jugador.x,
                    y: jugador.y,
                    angulo: jugador.angulo,
                    vida: jugador.vida,
                    personaje: jugador.personaje
                });
            }
        }
        
        if (jugadoresActualizados.length > 0) {
            io.to(salaId).emit('actualizarJugadores', jugadoresActualizados);
        }
    }
}

// Iniciar loops
setInterval(actualizarBalas, 16); // 60 fps para física
setInterval(enviarActualizacionesPosiciones, FRECUENCIA_ACTUALIZACION); // ~30 fps para posiciones

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ====================================
    🎮 SERVIDOR SHOOTER MULTIPLAYER
    ====================================
    🌐 Local: http://localhost:${PORT}
    📡 Puerto: ${PORT}
    ⏰ Duración de partida: 5 minutos
    ✅ Cooldown de disparo: 300ms
    ✅ Anti-cheat: 30px
    ✅ Optimizaciones: Quadtree + Pool de balas + 30fps
    ====================================
    `);
});