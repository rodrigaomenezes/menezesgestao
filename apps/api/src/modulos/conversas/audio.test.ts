import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { amostrasOpus, lerWebmOpus, prepararAudio, webmParaOgg } from "./audio.js";

// Gravações de teste: 2 s (tamanhos conhecidos) e 1,5 s (tamanhos desconhecidos, como o navegador grava).
const voz = readFileSync(new URL("./__fixtures__/voz.webm", import.meta.url));
const aoVivo = readFileSync(new URL("./__fixtures__/voz-ao-vivo.webm", import.meta.url));

/** Separa as páginas Ogg conferindo a assinatura e o CRC de cada uma. */
function paginasOgg(ogg: Buffer) {
  const paginas: { tipo: number; granulo: bigint; corpo: Buffer }[] = [];
  let pos = 0;
  while (pos < ogg.length) {
    expect(ogg.subarray(pos, pos + 4).toString("latin1")).toBe("OggS");
    const nSeg = ogg[pos + 26];
    const segs = [...ogg.subarray(pos + 27, pos + 27 + nSeg)];
    const tamanho = 27 + nSeg + segs.reduce((a, b) => a + b, 0);
    const pagina = Buffer.from(ogg.subarray(pos, pos + tamanho));
    const crc = pagina.readUInt32LE(22);
    pagina.writeUInt32LE(0, 22);
    // CRC do Ogg (polinômio 0x04c11db7, sem reflexão)
    let calc = 0;
    for (const byte of pagina) {
      calc ^= byte << 24;
      for (let j = 0; j < 8; j++) calc = calc & 0x80000000 ? (calc << 1) ^ 0x04c11db7 : calc << 1;
      calc >>>= 0;
    }
    expect(calc).toBe(crc);
    paginas.push({ tipo: ogg[pos + 5], granulo: ogg.readBigInt64LE(pos + 6), corpo: pagina.subarray(27 + nSeg) });
    pos += tamanho;
  }
  return paginas;
}

describe("áudio do navegador → mensagem de voz", () => {
  it.each([
    ["tamanhos conhecidos", voz, 2],
    ["tamanhos desconhecidos (navegador)", aoVivo, 1.5],
  ])("WebM/Opus vira Ogg/Opus válido (%s)", (_nome, webm, segundos) => {
    const ogg = webmParaOgg(webm);
    const paginas = paginasOgg(ogg);
    expect(paginas[0].tipo).toBe(0x02); // início do fluxo
    expect(paginas[0].corpo.subarray(0, 8).toString("latin1")).toBe("OpusHead");
    expect(paginas[1].corpo.subarray(0, 8).toString("latin1")).toBe("OpusTags");
    const ultima = paginas[paginas.length - 1];
    expect(ultima.tipo).toBe(0x04); // fim do fluxo
    const preSkip = paginas[0].corpo.readUInt16LE(10);
    const duracao = Number(ultima.granulo - BigInt(preSkip)) / 48_000;
    expect(duracao).toBeGreaterThan(segundos - 0.05);
    expect(duracao).toBeLessThan(segundos + 0.1);
  });

  it("lê todos os pacotes e calcula a duração de cada um pelo TOC", () => {
    const { pacotes } = lerWebmOpus(voz);
    expect(pacotes.length).toBeGreaterThan(50);
    expect(amostrasOpus(pacotes[1])).toBe(960); // 20 ms
  });

  it("formatos que já servem seguem como estão; WebM vira voz", () => {
    expect(prepararAudio(voz, "audio/webm;codecs=opus")).toMatchObject({ mime: "audio/ogg", voz: true });
    expect(prepararAudio(Buffer.from("x"), "audio/mp4")).toMatchObject({ mime: "audio/mp4", voz: false, extensao: "m4a" });
  });

  it("recusa o que não é WebM com Opus", () => {
    expect(() => webmParaOgg(Buffer.from("não é áudio nenhum"))).toThrow(/WebM/);
  });
});
