/**
 * Admin Panel - Brazier Flame Animation
 */

// Initialize brazier animations after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initRSBrazier(document.getElementById('flameLeft'));
  initRSBrazier(document.getElementById('flameRight'));
});

function initRSBrazier(canvas) {
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const particles = [];
  const smoke = [];

  function drawBrazier() {
    const cx = canvas.width / 2;
    const cy = canvas.height - 50;
    ctx.fillStyle = '#222';
    ctx.fillRect(cx - 60, cy + 50, 120, 20);
    const legW = 6;
    const legH = 150;
    const spacing = 10;
    ctx.fillStyle = '#444';
    ctx.fillRect(cx - spacing * 1, cy - legH + 20, legW, legH);
    ctx.fillRect(cx - spacing * 0, cy - legH + 20, legW, legH);
    ctx.fillRect(cx + spacing * 1, cy - legH + 20, legW, legH);
    const potY = cy - legH;
    ctx.beginPath();
    ctx.moveTo(cx - 40, potY);
    ctx.quadraticCurveTo(cx, potY - 50, cx + 40, potY);
    ctx.closePath();
    ctx.fillStyle = '#333';
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.stroke();
    const grad = ctx.createRadialGradient(cx, potY - 25, 5, cx, potY - 25, 35);
    grad.addColorStop(0, 'rgba(0,255,0,0.7)');
    grad.addColorStop(0.5, 'rgba(0,200,0,0.4)');
    grad.addColorStop(1, 'rgba(0,100,0,0.1)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function createParticle() {
    const cx = canvas.width / 2;
    const cy = canvas.height - 50 - 150;
    const x = cx + (Math.random() * 30 - 15);
    const y = cy;
    const size = Math.random() * 8 + 4;
    const speed = Math.random() * 1 + 0.5;
    const colorArr = [
      'rgba(0,255,0,0.6)',
      'rgba(0,200,0,0.4)',
      'rgba(0,150,0,0.3)'
    ];
    const color = colorArr[Math.floor(Math.random() * colorArr.length)];
    particles.push({ x, y, size, speed, color, angle: Math.random() * Math.PI * 2 });
  }

  function createSmoke() {
    const cx = canvas.width / 2;
    const cy = canvas.height - 50 - 150;
    const x = cx + (Math.random() * 20 - 10);
    const y = cy;
    const size = Math.random() * 15 + 10;
    smoke.push({ x, y, size, alpha: 0.1 + Math.random() * 0.2 });
  }

  function update() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBrazier();

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.y -= p.speed;
      p.x += Math.sin(p.angle) * 0.5;
      p.size *= 0.97;
      p.angle += 0.05;
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      if (p.size < 1 || p.y < 0) {
        particles.splice(i, 1);
      }
    }
    if (particles.length < 80) {
      createParticle();
    }

    for (let i = smoke.length - 1; i >= 0; i -= 1) {
      const s = smoke[i];
      s.y -= 0.3;
      s.alpha *= 0.99;
      ctx.beginPath();
      ctx.fillStyle = `rgba(200,200,200,${s.alpha})`;
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      if (s.alpha < 0.01) {
        smoke.splice(i, 1);
      }
    }
    if (smoke.length < 30) {
      createSmoke();
    }

    requestAnimationFrame(update);
  }

  update();
}
