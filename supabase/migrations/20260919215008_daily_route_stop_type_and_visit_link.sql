-- Enlaza planificación (scheduled_visit) con ejecución (visit) para la ruta del día.
-- Sin scheduled_visit_id, completed_at habría que inferirlo por (customer_id,
-- route_user_id, ventana del día): eso duplica filas si el vendedor visita al mismo
-- cliente dos veces, y no distingue un Despacho de un Cobro al mismo cliente el mismo
-- día -- que es justo lo que el wireframe dibuja como dos tarjetas separadas.
-- scheduled_visit está vacía en todos los entornos y sin escritor en el código: barato
-- ahora, caro después de que el check-in dependa de ella.

ALTER TABLE public.scheduled_visit
  ADD CONSTRAINT scheduled_visit_stop_type_chk
  CHECK (stop_type IN ('visit','dispatch','collection'));

ALTER TABLE public.visit
  ADD COLUMN scheduled_visit_id uuid REFERENCES public.scheduled_visit(id);

-- El índice único parcial es lo que garantiza que el LEFT JOIN de la ruta del día
-- devuelva a lo sumo una fila de ejecución por parada planificada.
CREATE UNIQUE INDEX visit_scheduled_visit_uq ON public.visit (scheduled_visit_id)
  WHERE scheduled_visit_id IS NOT NULL AND deleted_at IS NULL;

-- Omisiones deliberadas de esta migración -- para que nadie las "arregle" después.
--
-- 1. scheduled_visit.sort_order: no se agrega. Hoy nadie lo escribiría (quedaría
--    100% NULL) y su semántica está sin decidir -- ¿orden del día, o el mismo orden
--    que route_customer.sort_order ya guarda para la composición de la ruta?
--    Agregar la columna ahora fijaría una decisión de modelo que el equipo todavía
--    no tomó.
--
-- 2. Políticas RLS y GRANTs para scheduled_visit: no se agregan. La API conecta como
--    postgres y bypassea RLS; la app solo llega a esta tabla vía apiFetch. Un
--    GRANT SELECT ... TO authenticated abriría un camino directo a Supabase que hoy
--    nadie usa ni prueba. El comentario de 20260912042029_rls_policies_and_grants.sql
--    ya deja la regla escrita: "Add policies alongside the feature that needs them" --
--    esta migración todavía no es esa feature.
