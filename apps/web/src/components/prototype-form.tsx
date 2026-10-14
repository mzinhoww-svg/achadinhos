"use client";

import type { FormHTMLAttributes } from "react";

/**
 * Formulário de protótipo (sem persistência). Um <form> sem handler com um único input faz o
 * Enter navegar via GET e o valor cai na URL (histórico, logs, Referer). Aqui o envio implícito
 * é cancelado e o método é POST, para que nenhum campo — sobretudo segredos — vá para a rota.
 */
export function PrototypeForm(props: FormHTMLAttributes<HTMLFormElement>) {
  return <form {...props} method="post" onSubmit={(e) => e.preventDefault()} />;
}
