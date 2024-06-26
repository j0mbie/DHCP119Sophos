
// option119.js - DHCP Option 119 encoder
// Copyright (C) 2020 John J. Jordan

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// ==============================================================================

// Encodes raw input (space-separated domain name list)
function encodeInput(s) {
    let parts = s.toLowerCase().split(" ").filter(function (p) { return p.length > 0; });
    if (parts.length > 0) {
        return encode(parts);
    } else {
        throw "Empty input";
    }
}

// Encodes an array of domain names
// The result is an array where each element is either a number (representing
// one byte) or a one-character string.
function encode(domains) {
    let refs = {};
    let result = [];

    for (let i = 0; i < domains.length; i++) {
        let domain = domains[i];
        let branched = false;
        for (let t = 0; t < domain.length; t++) {
            let subdomain = domain.substr(t);
            if (typeof refs[subdomain] === 'number') {
                let ptr = 0xC000 | refs[subdomain];
                result.push((ptr >> 8) & 0xff);
                result.push(ptr & 0xff);
                branched = true;
                break;
            }

            refs[subdomain] = result.length;

            let dot = domain.indexOf(".", t);
            if (dot < 0) {
                dot = domain.length;
            }

            if (dot == t) {
                throw "Empty segment";
            }

            result.push(dot - t);
            for (; t < dot; t++) {
                result.push(domain.charAt(t));
            }
        }

        if (!branched) {
            result.push(0);
        }
    }

    return result;
}

// Encodes the result of encode() to Mikrotik RouterOS form.
function toMikrotik(encoded) {
    let result = [];

    for (let i = 0; i < encoded.length; ) {
        if (typeof encoded[i] == 'number') {
            result.push("0x");
            for (; typeof encoded[i] == 'number'; i++) {
                result.push(octetHex(encoded[i]));
            }
        } else if (typeof encoded[i] == 'string') {
            result.push("'");
            for (; typeof encoded[i] == 'string'; i++) {
                result.push(encoded[i]);
            }

            result.push("'");
        } else {
            // Try not to infinite loop.
            throw "Unexpected value in result";
        }
    }

    return result.join("");
}

// Converts one element from encode() to a hexadecimal string representing
// that byte.
function cvtHex(e) {
    if (typeof e == 'number') {
        return octetHex(e);
    } else if (typeof e == 'string') {
        return octetHex(e.charCodeAt(0));
    } else {
        throw "Unexpected value";
    }
}

// Converts one element from encode() to a decimal (0-255) string representing
// that byte.
function cvtDecimal(e) {
	return Number("0x" + e);
}

// Converts a result from encode() to a hex string with optional separator.
function toHex(encoded, sep) {
    return encoded.map(cvtHex).join(sep || "");
}

// Converts a result from encode() to a decimal (0-255) string with optional separator.
function toDecimal(encoded, sep) {
	let HexArray = encoded.map(cvtHex);
    let DecArray = HexArray.map(cvtDecimal);
    return DecArray.join(sep);
}

// Converts a result from encode() to a string for Cisco IOS
function toCisco(encoded) {
    function cvtCisco(e, idx) {
        return (idx > 0 && idx % 2 == 0 ? "." : "") + cvtHex(e);
    }

    return encoded.map(cvtCisco).join("");
}

// Converts a result from encode() to a C-compatible string
function toCstring(encoded) {
    function cvtCstring(e) {
        return typeof e == 'number' ? "\\x" + octetHex(e) : e;
    }

    return encoded.map(cvtCstring).join("");
}

// Converts a number to a two-byte hex string.
function octetHex(n) {
    return ("0" + n.toString(16).toUpperCase()).slice(-2);
}

// Decodes an array of numbers (representing bytes) to a domain search list.
function decode(input) {
    let result = [];

    for (let i = 0; i < input.length;) {
        let name = readName(input, i);
        result.push(name.name);
        i = name.next;
    }

    return result.join(" ");
}

// Reads a domain name from the input starting from idx and extending until
// an END marker (00) is found.
function readName(input, idx) {
    let result = [];
    for (let i = idx; i < input.length;) {
        let seg = decodeSegment(input, i);
        if (seg.kind == "end") {
            return {name: result.join("."), next: seg.next};
        } else if (seg.kind == "text") {
            result.push(seg.text);
            i = seg.next;
        } else if (seg.kind == "ptr") {
            if (seg.ptr >= idx) {
                throw "Invalid forward or circular reference";
            }

            result.push(readName(input, seg.ptr).name);
            return {name: result.join("."), next: seg.next};
        } else {
            throw "Unknown segment kind";
        }
    }

    throw "Missing END marker";
}

// Decodes a single segment from input starting from idx.
function decodeSegment(input, idx) {
    let d = input[idx];
    if (d == 0) {
        return {kind: "end", next: idx + 1};
    } else if ((d & 0xc0) == 0xc0) {
        return {kind: "ptr", next: idx + 2, ptr: (d & 0x3f) << 8 | input[idx + 1]};
    } else if ((d & 0xc0) != 0) {
        throw "Bad start byte";
    } else if ((idx + d) >= input.length) {
        throw "Segment extends beyond end of input";
    } else {
        return {kind: "text", next: idx + d + 1, text: String.fromCharCode.apply(null, input.slice(idx + 1, idx + d + 1))};
    }
}

// Converts a Mikrotik-formatted input string to an array of numbers.
function fromMikrotik(s) {
    let result = [];
    for (let i = 0; i < s.length;) {
        if (s.charAt(i) == "'") {
            for (i++; i < s.length && s.charAt(i) != "'"; i++) {
                result.push(s.charCodeAt(i));
            }

            if (s.charAt(i) == "'") {
                i++;
            } else {
                throw "Unterminated string";
            }
        } else if (s.substr(i, 2).toLowerCase() == "0x") {
            for (i += 2; i < s.length - 1 && isHex(s.substr(i, 2)); i += 2) {
                result.push(parseInt(s.substr(i, 2), 16));
            }
        } else {
            throw "Unexpected input";
        }
    }

    return result;
}

// Converts a hex input string to an array of numbers.
function fromHex(s) {
    let result = [];

    for (let i = 0; i < s.length; i++) {
        if (" .;:\t".indexOf(s.charAt(i)) >= 0) {
            continue;
        }

        if (i == s.length - 1) {
            throw "Need an even number of hex digits";
        }

        let octet = s.substr(i, 2);
        if (!isHex(octet)) {
            throw "Unexpected hex character";
        }

        result.push(parseInt(octet, 16));
        i++;
    }

    return result;
}

// Returns true if all characters in the string are hex digits.
function isHex(s) {
    for (let i = 0; i < s.length; i++) {
        if ("0123456789abcdefABCDEF".indexOf(s.charAt(i)) < 0) {
            return false;
        }
    }

    return true;
}

// Parses a c-like string literal into an array of numbers
// NOTE: only supports octal and hex escapes.
function fromCstring(s) {
    let result = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c == 0x5C) { // backslash
            if (s.charAt(i + 1) == "x") {
                result.push(parseInt(s.substr(i + 2, 2), 16));
                i += 3;
            } else {
                let length = 0;
                let start = i;
                for (i++; "01234567".indexOf(s.charAt(i)) >= 0; i++, length++) {}

                if (length == 0) {
                    throw "Unsupported escape code in C string";
                }
                
                result.push(parseInt(s.substr(start, length), 8));
            }
        } else {
            result.push(c);
        }
    }
    
    return result;
}

// Returns viewmodel for knockout.js
function viewmodel() {
    return {
        encoder: {
            input: ko.observable(),
            mikrotik: ko.observable(),
            cisco: ko.observable(),
            hex: ko.observable(),
            spacedHex: ko.observable(),
            cstring: ko.observable(),
            Sophos: ko.observable(),
            error: ko.observable(),
            encode: function () {
                try {
                    this.clear();

                    if (!this.input()) {
                        return;
                    }

                    let result = encodeInput(this.input());
                    this.mikrotik(toMikrotik(result));
                    this.cisco(toCisco(result));
                    this.hex(toHex(result));
                    this.spacedHex(toHex(result, " "));
                    this.cstring(toCstring(result));
                    this.Sophos(toDecimal(result));
                } catch (e) {
                    this.clear();
                    this.error(e);
                }
            },
            clear: function() {
                [this.mikrotik, this.cisco, this.hex, this.spacedHex, this.cstring, this.Sophos, this.error].forEach(function (f) { f(""); });
            },
            reset: function() {
                this.clear();
                this.input("");
            },
        },

        decoder: {
            input: ko.observable(),
            error: ko.observable(),
            output: ko.observable(),
            decode: function() {
                try {
                    this.clear();

                    let input = this.input();
                    if (!input) {
                        return;
                    }

                    let hex = [];
                    if (input.indexOf("\\") >= 0) {
                        hex = fromCstring(input);
                    } else if (input.toLowerCase().indexOf("0x") >= 0 || input.indexOf("'") >= 0) {
                        hex = fromMikrotik(input);
                    } else {
                        hex = fromHex(input);
                    }

                    this.output(decode(hex));
                } catch (e) {
                    this.clear();
                    this.error(e);
                }
            },
            clear: function() {
                this.output("");
                this.error("");
            },
            reset: function() {
                this.clear();
                this.input("");
            },
        },
    };
}
