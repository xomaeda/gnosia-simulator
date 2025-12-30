export function drawGraph(canvas, game) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const r = 250;
  const cx = canvas.width/2;
  const cy = canvas.height/2;

  game.characters.forEach((c,i)=>{
    const a = i / game.characters.length * Math.PI*2;
    ctx.fillText(c.name, cx + Math.cos(a)*r, cy + Math.sin(a)*r);
  });
}

