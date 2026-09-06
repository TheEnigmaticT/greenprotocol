import { assertGraph, type GraphRevision } from './graph'
import type { Source } from './source'

/** Literal occurrence projection only: conversion and chemistry interpretation remain
 * separate. Complete material quantities do not establish extraction completeness. */
export function buildAnchoredChemistryInput(source: Source, graph: GraphRevision) {
  assertGraph(source, graph)
  const unresolvedFactIds = graph.facts.filter(f => f.status !== 'observed' || ['unclassified', 'unresolved-reference', 'mixture'].includes(f.category)).map(f => f.id)
  const materials = graph.facts.filter(f => f.category === 'material').sort((a, b) => a.anchor.start - b.anchor.start).map(material => {
    const links = graph.edges.filter(e => e.relation === 'quantity-of' && e.toFactId === material.id)
    const quantities = links.map(e => graph.facts.find(f => f.id === e.fromFactId)!)
    const quantity = links.length === 1 && links[0].status === 'observed' && quantities[0].category === 'quantity' && quantities[0].status === 'observed' && quantities[0].value === quantities[0].anchor.quote ? quantities[0].anchor.quote : null
    const name = material.status === 'observed' && material.value === material.anchor.quote ? material.anchor.quote : null
    return Object.freeze({ occurrenceId: material.id, sourceHash: source.id, graphHash: graph.id,
      name, quantity, factIds: Object.freeze([material.id, ...quantities.map(f => f.id)]), anchor: material.anchor })
  })
  return Object.freeze({ sourceHash: source.id, graphHash: graph.id, materials: Object.freeze(materials),
    unresolvedFactIds: Object.freeze(unresolvedFactIds),
    materialQuantitiesComplete: materials.length > 0 && unresolvedFactIds.length === 0 && materials.every(m => m.name !== null && m.quantity !== null),
    scientificAcceptance: 'unverified' as const })
}
