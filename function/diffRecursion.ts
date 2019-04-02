import * as array from 'yox-common/util/array'
import * as keypathUtil from 'yox-common/util/keypath'

import diffString from './diffString'
import diffArray from './diffArray'
import diffObject from './diffObject'
import matchFuzzyKeypath from './matchFuzzyKeypath'

export default function diffRecursion(
  keypath: string, newValue: any, oldValue: any,
  watchFuzzyKeypaths: string[],
  callback: (watchKeypath: string, keypath: string, oldValue: any) => void
) {

  const diff = function (subKeypath: string | number, subNewValue: any, subOldValue: any) {

    if (subNewValue !== subOldValue) {

      array.each(
        watchFuzzyKeypaths,
        function (fuzzyKeypath) {
          if (matchFuzzyKeypath(keypath, fuzzyKeypath)) {
            callback(
              fuzzyKeypath, keypath, oldValue
            )
          }
        }
      )

      diffRecursion(keypathUtil.join(keypath, subKeypath), subNewValue, subOldValue, watchFuzzyKeypaths, callback)

    }

  }

  diffString(newValue, oldValue, diff)
    || diffArray(newValue, oldValue, diff)
    || diffObject(newValue, oldValue, diff)

}