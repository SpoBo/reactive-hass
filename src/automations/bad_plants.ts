import ms from 'ms'
import { merge } from 'rxjs'
import { debounceTime, distinctUntilChanged, map, mergeMap, scan, skip, switchMap, take, tap } from 'rxjs/operators'
import DEBUG from 'debug'

import { IServicesCradle } from '../services/cradle'
import { HassEntityBase } from '../types'

const debug = DEBUG('reactive-hass.automations.bad_plants')

/**
 * TODO: Unit Testing.
 */
export default function bad_plants(cradle: IServicesCradle) {
    const plantsGrouped$ = cradle.states.entities$('plant.*')

    const plantsGroupedWithDelayedBad$ = plantsGrouped$
        .pipe(
            map(plant$ => {
                return plant$
                    .pipe(
                        tap(plant => {
                            if (plant.state === 'ok') {
                                debug(`plant ${plant.entity_id} is OK.`)
                                return
                            }

                            debug(`plant ${plant.entity_id} has problem ${plant.attributes.problem}`)
                        })
                    )
            }),
        )

    const plantsMerged$ = plantsGroupedWithDelayedBad$
        .pipe(
            mergeMap(v => v)
        )

    const events$ = plantsMerged$
        .pipe(
            scan((acc: Record<string, HassEntityBase>, plant) => {
                acc[plant.entity_id] = plant
                return acc
            }, {})
        )

    const message$ = events$
        .pipe(
            map((plants) => {
                const problems = Object
                    .values(plants)
                    .reduce((acc, plant) => {
                        if (plant.state !== 'ok') {
                            acc.push(plant.entity_id)
                        }

                        return acc
                    }, [] as string[])

                if (problems.length === 0) {
                    const names = Object.values(plants)
                        .map(plant => plant.attributes.friendly_name)

                  return `All plants (${names.join(', ')}) are OK.`
                }

                let bad = ''
                if (problems.length === 1) {
                    const plant = plants[problems[0]]

                    bad = `Plant ${plant.attributes.friendly_name || plant.entity_id} has a problem (${plant.attributes.problem}).`
                } else if (problems.length > 1) {
                    const mapped = problems
                        .map(entityId => {
                            const plant = plants[entityId]

                            return `${plant.attributes.friendly_name || plant.entity_id} (${plant.attributes.problem})`
                        })
                    bad = `Plants ${mapped.join(', ')} are in bad shape.`
                }

                const mappedGood = Object
                    .values(plants)
                    .reduce((acc, plant) => {
                        if (plant.state === 'ok') {
                          acc.push(plant.attributes?.friendly_name || plant.entity_id)
                        }

                        return acc
                    }, [] as string[])

                const good = mappedGood.length === 0 ? null : `${mappedGood.length === 1 ? 'Plant' : 'Plants'} ${mappedGood.join(', ')} ${mappedGood.length === 1 ? 'is' : 'are'} fine.`

                return [bad, good].filter(v => v).join(' ')
            }),
            debounceTime(ms('2s'))
        )

    const first$ = message$
        .pipe(
            take(1),
            tap(v => debug(v))
        )
    const rest$ = message$
        .pipe(
            tap(v => debug(v)),
            skip(1),
            distinctUntilChanged(),
            debounceTime(ms('2m')),
        )

    return merge(first$, rest$)
        .pipe(
            switchMap(message => {
                return cradle.service.call$({
                    domain: 'notify',
                    service: 'telegram_hass',
                    service_data: {
                        message,
                        title: 'Plants'
                    }
                })
            })
        )
}
