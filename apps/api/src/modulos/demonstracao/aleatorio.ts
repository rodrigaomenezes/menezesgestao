// Sorteio com semente fixa para a demonstração: a mesma empresa de exemplo sai sempre igual (dá para recriar e
// apresentar do mesmo jeito). Nomes, telefones e e-mails fictícios: e-mails no domínio reservado ".example".
const NOMES_F = ["Ana", "Beatriz", "Camila", "Daniela", "Eduarda", "Fernanda", "Gabriela", "Helena", "Isabela", "Juliana", "Larissa", "Mariana", "Natália", "Patrícia", "Rafaela", "Sofia", "Tatiane", "Vanessa", "Yasmin", "Alice", "Bruna", "Carolina", "Débora", "Elisa", "Flávia", "Giovana", "Heloísa", "Ingrid", "Jéssica", "Lívia", "Manuela", "Priscila", "Renata", "Sabrina", "Talita", "Valéria", "Luana", "Cecília", "Lorena", "Marina"];
const NOMES_M = ["André", "Bruno", "Carlos", "Diego", "Eduardo", "Felipe", "Gustavo", "Henrique", "Igor", "João", "Lucas", "Marcelo", "Nicolas", "Otávio", "Pedro", "Rafael", "Samuel", "Thiago", "Vinícius", "Arthur", "Bernardo", "Caio", "Davi", "Enzo", "Fábio", "Gabriel", "Heitor", "Leonardo", "Matheus", "Paulo", "Ricardo", "Sérgio", "Tiago", "Victor", "Wesley", "Murilo", "Renan", "Daniel", "Rodrigo", "Luiz"];
const SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos", "Gonçalves", "Santana", "Teixeira", "Araújo", "Pinto", "Correia", "Cavalcanti", "Monteiro", "Moura", "Campos", "Rezende", "Batista", "Duarte", "Farias", "Siqueira", "Toledo"];
const DDDS = ["11", "11", "11", "21", "31", "41", "51", "61", "71", "81", "19", "27", "48", "62", "85"];

export type Sorteio = ReturnType<typeof criarSorteio>;

/** Gerador mulberry32: rápido, determinístico e bom o bastante para dados de exemplo. */
export function criarSorteio(semente: number) {
  let s = semente >>> 0;
  const proximo = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inteiro = (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1));
  const um = <T>(lista: readonly T[]): T => lista[Math.floor(proximo() * lista.length)]!;
  const chance = (p: number) => proximo() < p;
  /** Escolha com pesos: [[valor, peso], ...]. */
  const pesado = <T>(opcoes: readonly (readonly [T, number])[]): T => {
    const total = opcoes.reduce((t, [, p]) => t + p, 0);
    let r = proximo() * total;
    for (const [v, p] of opcoes) if ((r -= p) < 0) return v;
    return opcoes[opcoes.length - 1]![0];
  };
  const usados = new Set<string>();

  return {
    proximo,
    inteiro,
    um,
    chance,
    pesado,
    /** Pessoa fictícia com e-mail e celular únicos (E.164 com nono dígito). */
    pessoa(): { nome: string; email: string; telefone: string } {
      for (;;) {
        const feminino = chance(0.55);
        const primeiro = um(feminino ? NOMES_F : NOMES_M);
        const sobrenome = `${um(SOBRENOMES)}${chance(0.35) ? ` ${um(SOBRENOMES)}` : ""}`;
        const nome = `${primeiro} ${sobrenome}`;
        const base = `${primeiro}.${sobrenome.split(" ").pop()}`
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase();
        const telefone = `+55${um(DDDS)}9${inteiro(6000, 9999)}${String(inteiro(0, 9999)).padStart(4, "0")}`;
        const email = `${base}${inteiro(1, 999)}@email.example`;
        if (usados.has(telefone) || usados.has(email)) continue;
        usados.add(telefone);
        usados.add(email);
        return { nome, email, telefone };
      }
    },
    /** Momento nos últimos `dias` dias, em horário comercial (8h–19h em São Paulo, UTC−3), mais nos dias úteis. */
    momento(dias: number, agora = Date.now()): Date {
      for (;;) {
        // Data de São Paulo (deslocada 3 h) para saber o dia da semana de lá; depois, hora de lá em UTC (+3).
        const d = new Date(agora - 3 * 3_600_000 - inteiro(0, dias) * 86_400_000);
        const semana = d.getUTCDay();
        if ((semana === 0 && !chance(0.1)) || (semana === 6 && !chance(0.35))) continue;
        d.setUTCHours(inteiro(8, 18) + 3, inteiro(0, 59), inteiro(0, 59), 0);
        if (d.getTime() > agora) continue;
        return d;
      }
    },
  };
}

/** Semente estável a partir de um texto (o segmento): "clinica" gera sempre a mesma clínica. */
export function sementeDe(texto: string): number {
  let h = 2166136261;
  for (const c of texto) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
