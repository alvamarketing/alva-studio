# Adaptadores de conversão NVS

- `Contract.php`: contrato comum e transporte HTTP sem logs de payload.
- `CoreMetaAdapter.php` e `CoreTikTokAdapter.php`: contratos Meta e TikTok compatíveis com a outbox Alva, sem expor o runtime vendorado.
- `GoogleEnhancedConversionsAdapter.php`: entrega Google Ads Enhanced Conversions for Leads pela Data Manager API.
- `LinkedInCapiAdapter.php`: entrega LinkedIn Conversions API com identificadores tipados e Restli 2.0.
- `TaboolaS2SAdapter.php`: entrega Taboola server-to-server pelo postback GET de hostname fixo e click ID validado.
- `Registry.php`: registro estável de destinos para o worker da outbox.
