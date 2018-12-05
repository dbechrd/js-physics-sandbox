window.onload = function() {
    window_resize();
    setInterval(tick, 1000/60);
}
window.onresize = function() {
    window_resize();
}

let canvas = document.getElementById("canvas");
document.addEventListener("mousemove", mouse_evt, false);
canvas.addEventListener("mousedown", mouse_evt, false);
canvas.addEventListener("mouseup", mouse_evt, false);
canvas.addEventListener("keydown", keyboard_evt, false);
canvas.addEventListener("keyup", keyboard_evt, false);
let ctx = canvas.getContext("2d");

let EPSILON = 0.0001;

let DEBUG_LOG_RECT_FORCES = false;
let DEBUG_LOG_RECT_STATE = false;
let DEBUG_LOG_KEYBOARD_EVENTS = true;

let CANVAS_METERS_HEIGHT = 20;
let PIXELS_PER_METER;
let FLOOR_HEIGHT = 100;  // pixels
let FLOOR_Y;

// HUD
let HUD_PAD = 4;
let HUD_H = 28;

function window_resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    PIXELS_PER_METER = canvas.height / CANVAS_METERS_HEIGHT;
    FLOOR_Y = (canvas.height - FLOOR_HEIGHT) / PIXELS_PER_METER;
    canvas.focus();
}

let mouse_x;
let mouse_y;
let mouse_changed = false;
let mouse_down = false;

player_jump_pressed = false;
player_move_left_pressed = false;
player_move_right_pressed = false;
next_frame_pressed = false;
next_frame_repeat_pressed = false;

let STATE_MENU = "menu";
let STATE_FRAME = "frame";
let STATE_RUN = "run";

let frames = 0;

let state_prev = STATE_RUN;
let state = STATE_RUN;
let hud_text;

function Vector2D(x, y) {
    this.x = x;
    this.y = y;
    this.length = function () {
        return Math.sqrt(this.x*this.x + this.y*this.y);
    }
    this.zero = function () {
        this.x = 0;
        this.y = 0;
    }
    this.add = function (other) {
        this.x += other.x;
        this.y += other.y;
        return this;
    }
    this.subtract = function (other) {
        this.x -= other.x;
        this.y -= other.y;
        return this;
    }
    this.scale = function (scale) {
        this.x *= scale;
        this.y *= scale;
        return this;
    }
    this.draw = function (origin) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.lineTo(origin.x, origin.y);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
    }
}
Vector2D.zero = function () {
    return new Vector2D(0, 0);
}
Vector2D.copy = function (other) {
    return new Vector2D(other.x, other.y);
}
Vector2D.add = function (a, b) {
    return new Vector2D(a.x + b.x, a.y + b.y);
}
Vector2D.subtract = function (a, b) {
    return new Vector2D(a.x - b.x, a.y - b.y);
}
Vector2D.scale = function (vec, scale) {
    return new Vector2D(vec.x * scale, vec.y * scale);
}

function Force(dir, time) {
    this.dir = dir;
    this.time = time;
    this.log = function (str) {
        console.log(str + "[dir: " + this.dir.x + ", " + this.dir.y + "][time: " + this.time + "]");
    }
}

let next_id = 1000;
function Rect(x, y, w, h) {
    this.id = next_id++;
    this.pos = new Vector2D(x + w/2, y + h/2);
    this.dpos = new Vector2D(0, 0);
    this.vel = new Vector2D(0, 0);
    this.acc = new Vector2D(0, 0);
    this.extents = new Vector2D(w/2, h/2);
    this.angle = 0;
    this.torque = 0;
    this.mass = 150;
    this.inv_mass = 1 / this.mass;
    this.resting = false;
    this.touching = false;
    this.forces = [];
    this.x = function () {
        return this.pos.x - this.extents.x
    }
    this.y = function () {
        return this.pos.y - this.extents.y
    }
    this.w = function () {
        return this.extents.x * 2;
    }
    this.h = function () {
        return this.extents.y * 2;
    }
    this.apply_force = function (force) {
        if (DEBUG_LOG_RECT_FORCES) {
            force.log("[Rect " + this.id + "][apply_force]");
        }
        this.forces.push(force);
        this.resting = false;
    }
    this.update = function (dt) {
        if (this.resting) { return; }

        let f_net = new Vector2D(0, 9.81);
        let f_idx = this.forces.length;
        while (f_idx--) {
            let force = this.forces[f_idx];
            if (force.time > EPSILON) {
                if (DEBUG_LOG_RECT_FORCES) {
                    force.log("[Rect " + this.id + "][force_add]");
                }
                f_net.add(force.dir);
                force.time -= dt;
            } else {
                if (DEBUG_LOG_RECT_FORCES) {
                    force.log("[Rect " + this.id + "][force_pop]");
                }
                this.forces.pop();
            }
        }

        let pos_prev = Vector2D.copy(this.pos);

        this.acc = Vector2D.scale(f_net, this.inv_mass);
        //this.vel.add(Vector2D.scale(this.acc, dt));
        //this.pos.add(Vector2D.scale(this.vel, dt));
        let dv = Vector2D.scale(this.acc, dt);
        this.vel.add(dv);
        this.vel.scale(0.99);
        let dp = Vector2D.scale(this.vel, dt);
        this.pos.add(dp);

        if (DEBUG_LOG_RECT_STATE) {
            console.log("[" + this.id + "][update] " +
                "\nAcc: " + this.acc.x + ", " + this.acc.y +
                "\nVel: " + this.vel.x + ", " + this.vel.y +
                "\nPos: " + this.pos.x + ", " + this.pos.y
            );
        }

        this.vel.x *= 0.95;
        if (this.pos.y + this.extents.y >= FLOOR_Y) {
            this.acc.y = 0;
            if (this === player) {
                this.vel.y = 0;      // not bouncy player
            } else {
                this.vel.y *= -0.7;  // bouncy boxes
            }
            // TODO: Proper time-of-collision calculation. Apply remaining
            // velocity upward rather than just snapping to floor.
            this.pos.y = FLOOR_Y - this.extents.y;
            this.touching = true;
        } else {
            this.touching = false;
        }

        let diff = Vector2D.subtract(this.pos, pos_prev).length();
        if (diff <= EPSILON) {
            this.acc.zero();
            this.vel.zero();
            this.resting = true;
        } else {
            this.resting = false;
        }
    }
    this.draw = function () {
        rect(
            this.x() * PIXELS_PER_METER,
            this.y() * PIXELS_PER_METER,
            this.w() * PIXELS_PER_METER,
            this.h() * PIXELS_PER_METER,
            "fill",
            this.resting ? "#0ff" : (this.touching ? "#f00" : "#f0f")
        );
    }
}

let player = new Rect(05, 2, 1, 1);
let blocks = [
    new Rect(10, 2, 1, 1),
    new Rect(12, 2, 1, 1),
    new Rect(14, 2, 1, 1),
];

function pause() {
    prev_state = state;
    state = STATE_MENU;
}
function unpause() {
    tmp = state;
    state = prev_state;
    prev_state = tmp;
}

function mouse_evt(e) {
    mouse_changed = false;

    switch(e.type) {
    case "mousemove":
        mouse_x = e.x;
        mouse_y = e.y;
        break;
    case "mousedown":
        mouse_x = e.x;
        mouse_y = e.y;
        mouse_down = true;
        mouse_changed = true;
        break;
    case "mouseup":
        mouse_x = e.x;
        mouse_y = e.y;
        mouse_down = false;
        mouse_changed = true;
        break;
    }
}

//case 'z':
//case String.fromCharCode(26):
function keyboard_evt(e) {
    if (DEBUG_LOG_KEYBOARD_EVENTS) {
        let repeat = e.repeat ? '(repeat)' : ''
        console.log(e.type + ':' + repeat + ' \'' + e.key + '\' [' + e.keyCode + ']');
    }
    switch(state) {
        case STATE_MENU:
            menu_kbd(e);
            break;
        case STATE_FRAME:
            frame_kbd(e);
            break;
        case STATE_RUN:
            run_kbd(e);
            break;
        default:
            alert("Unknown state: " + state);
    }
}
function menu_kbd(e) {
    switch(e.key) {
        case 'p':
            if (e.type == "keydown") unpause();
            break;
    }
}
function player_kbd(e) {
    switch(e.key) {
        case 'w':
            player_jump_pressed = (e.type == "keydown");
            break;
        case 'a':
            player_move_left_pressed = (e.type == "keydown");
            break;
        case 'd':
            player_move_right_pressed = (e.type == "keydown");
            break;
    }
}
function frame_kbd(e) {
    switch(e.key) {
        case 'p':
            if (e.type == "keydown") state = STATE_RUN;
            break;
        case 'n':
            next_frame_pressed = (e.type == "keydown" && !e.repeat);
            break;
        case 'm':
            next_frame_repeat_pressed = (e.type == "keydown");
            break;
        default:
            player_kbd(e);
    }
}
function run_kbd(e) {
    switch(e.key) {
        case 'p':
            if (e.type == "keydown") pause();
            break;
        case 'n':
            if (e.type == "keydown") state = STATE_FRAME;
            break;
        default:
            player_kbd(e);
    }
}

function clear(color) {
    ctx.lineWidth = 4;
    ctx.fillStyle = color ? color : "#208";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function tick() {
    clear();
    switch(state) {
        case "menu":
            menu_tick();
            menu_render();
            break;
        case "frame":
            if (next_frame_pressed) {
                next_frame_pressed = false;
                run_tick(1);
            } else if (next_frame_repeat_pressed) {
                run_tick(1);
            }
            run_render();
            break;
        case "run":
            run_tick(1);
            run_render();
            break;
    }
}

function menu_tick() {
}
function menu_render() {
    //hud_text = "Game Paused [Press 'p' to continue]"
    run_render();
}

function run_tick(dt) {
    frames += dt;
    for (let block of blocks) {
        block.update(dt);
    }

    if (player_jump_pressed) {
        player_jump();
    }
    if (player_move_left_pressed) {
        player_move_left();
    }
    if (player_move_right_pressed) {
        player_move_right();
    }
    player.update(dt);
}
function player_jump() {
    if (player.touching) {
        let force = new Force(new Vector2D(0, -150), 1);
        player.apply_force(force);
    }
}
function player_move_left() {
    let force = new Force(new Vector2D(-2, 0), 1);
    player.apply_force(force);
}
function player_move_right() {
    let force = new Force(new Vector2D(2, 0), 1);
    player.apply_force(force);
}

function run_render() {
    run_render_floor();
    run_render_objects();
    run_render_hud();
}
function run_render_floor() {
    rect(0, canvas.height - FLOOR_HEIGHT, canvas.width, FLOOR_HEIGHT, "fill", "#280");
}
function run_render_objects() {
    for (let block of blocks) {
        block.draw();
    }
    player.draw();
}
function run_render_hud() {
    rect(HUD_PAD, HUD_PAD, canvas.width-8, HUD_H, "both", "white");
    msg = "[frame: " + frames + "][state: " + state + "] " + (hud_text ? hud_text : "");
    text(msg, canvas.width/2, HUD_H-4, "black");
}

function rect(x, y, w, h, mode, color) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    if (mode == "outline" || mode == "both") {
        ctx.stroke();
    }
    if (mode == "fill" || mode == "both") {
        ctx.fillStyle = color;
        ctx.fill();
    }
}

function circle(x, y, radius, mode, color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2*Math.PI);
    ctx.closePath();
    if (mode == "outline" || mode == "both") {
        ctx.stroke();
    }
    if (mode == "fill" || mode == "both") {
        ctx.fillStyle = color;
        ctx.fill();
    }
}

function text(text, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = "16pt Consolas";
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
}
