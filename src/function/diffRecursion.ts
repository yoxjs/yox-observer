import * as constant from 'yox-common/src/util/constant'
import * as keypathUtil from 'yox-common/src/util/keypath'

import diffString from './diffString'
import diffArray from './diffArray'
import diffObject from './diffObject'

/**
 * 递归对比
 */
export default function diffRecursion(
  keypath: string,
  newValue: any,
  oldValue: any,
  fuzzyKeypaths: string[],
  fuzzyKeypathLength: number,
  callback: (watchKeypath: string, keypath: string, newValue: any, oldValue: any) => void
) {

  const diff = function (subKey: string, subNewValue: any, subOldValue: any) {

    if (subNewValue !== subOldValue) {

      const newKeypath = keypathUtil.join(keypath, subKey)

      for (let i = 0; i < fuzzyKeypathLength; i++) {
        const fuzzyKeypath = fuzzyKeypaths[i]
        if (keypathUtil.matchFuzzy(newKeypath, fuzzyKeypath) !== constant.UNDEFINED) {
          callback(
            fuzzyKeypath, newKeypath, subNewValue, subOldValue
          )
        }
      }

      diffRecursion(newKeypath, subNewValue, subOldValue, fuzzyKeypaths, fuzzyKeypathLength, callback)

    }

  }

  diffString(newValue, oldValue, diff)
    || diffArray(newValue, oldValue, diff)
    || diffObject(newValue, oldValue, diff)

}