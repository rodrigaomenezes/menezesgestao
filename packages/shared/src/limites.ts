// Limites de validação compartilhados: o front orienta antes do envio, o servidor decide.
export const SENHA_MINIMO = 10;
export const SENHA_MAXIMO = 128;
/** Campos personalizados ativos por tipo de registro (contato, oportunidade) e etiquetas ativas por empresa. */
export const MAX_CAMPOS_POR_TIPO = 50;
export const MAX_ETIQUETAS = 200;
/** Telefones e e-mails extras (além dos principais) e endereços ativos por contato: a ficha cabe na tela do celular. */
export const MAX_CANAIS_POR_CONTATO = 10;
export const MAX_ENDERECOS_POR_CONTATO = 5;
