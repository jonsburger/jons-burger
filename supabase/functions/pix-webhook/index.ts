// RESERVADO PARA O FUTURO — NÃO ESTÁ EM USO e NÃO confirma pagamento algum.
// Hoje a confirmação do Pix é MANUAL pelo administrador (painel > Detalhe do pedido).
// Quando houver um provedor de pagamento com webhook (Mercado Pago, Asaas, Efí...), esta função deve:
//  1) validar a ASSINATURA do webhook com o segredo do provedor (supabase secrets set ...);
//  2) usar a service_role (variável de ambiente da função, nunca no site) para marcar o pedido como pago;
//  3) registrar o evento em order_events.
// Enquanto isso, responde 501 para que ninguém consiga "simular" um pagamento.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "nao_implementado", message: "Nenhum provedor de pagamento integrado." }), {
    status: 501,
    headers: { "Content-Type": "application/json" },
  })
);
