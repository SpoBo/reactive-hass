import ms from 'ms'
import { merge, partition } from 'rxjs'
import { delay, distinctUntilChanged, map, mergeMap, scan, switchMap, tap } from 'rxjs/operators'
import DEBUG from 'debug'

import { IServicesCradle } from '../services/cradle'
import { HassEntityBase } from '../types'

const debug = DEBUG('reactive-hass.automations.bad_plants')

export default function test$(cradle: IServicesCradle) {
    const plantsGrouped$ = cradle.states.entities$('plant.*')

    const plantsGroupedWithDelayedBad$ = plantsGrouped$
        .pipe(
            map(plant$ => {
                const [ok$, bad$] = partition(plant$, (plant) => plant.state === 'ok')
                return merge(ok$, bad$.pipe(delay(ms('10m'))))
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
                const problems = Object.values(plants)
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

                if (problems.length === 1) {
                    const plant = plants[problems[0]]

                    return `Plant ${plant.attributes.friendly_name || plant.entity_id} has a problem. (${plant.attributes.problem})`
                }

                const mapped = problems
                 .map(entityId => {
                     const plant = plants[entityId]

                     return `${plant.attributes.friendly_name || plant.entity_id} (${plant.attributes.problem})`
                 })

                return `Plants ${problems.join(', ')} are in bad shape.`
            })
        )

    return message$
        .pipe(
            tap(v => debug(v)),
            distinctUntilChanged(),
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
