type HoursAndMinutes = {
    hours: number;
    minutes: number;
}

function parseTimeString (input: string): HoursAndMinutes {
    const split = input.split(':')
    return {
        hours: Number(split[0]),
        minutes: split[1] ? Number(split[1]) : 0
    }
}

function isAfter(timestamp: HoursAndMinutes, reference: HoursAndMinutes): boolean {
    return timestamp.hours === reference.hours && timestamp.minutes >= reference.minutes || timestamp.hours > reference.hours
}

function isOn(timestamp: HoursAndMinutes, reference: HoursAndMinutes): boolean {
    return timestamp.hours === reference.hours && timestamp.minutes === reference.minutes
}

function isBefore(timestamp: HoursAndMinutes, reference: HoursAndMinutes): boolean {
    return !isAfter(timestamp, reference)
}

function getTimestamp(date: Date): HoursAndMinutes {
    return {
        hours: date.getHours(),
        minutes: date.getMinutes()
    }
}

export default function inTimeRange(start: string, end: string) {
    let starting = parseTimeString(start)
    let ending = parseTimeString(end)

    const endingBeforeStart = isBefore(ending, starting)

    if (isOn(starting, ending)) {
        return () => true
    }

    return function(date: Date) {
        const timestamp = getTimestamp(date)

        if (isOn(timestamp, starting) || isOn(timestamp, ending)) {
            return true
        }

        const afterStart = isAfter(timestamp, starting)
        const beforeEnd = isBefore(timestamp, ending)

        if (endingBeforeStart) {
            const beforeStart = isBefore(timestamp, starting)
            const afterEnd = isAfter(timestamp, ending)
            return beforeStart ? beforeEnd : afterEnd
        }

        return afterStart && beforeEnd
    }
}
