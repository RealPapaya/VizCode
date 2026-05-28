#!/usr/bin/env python3
"""Standalone verification harness for the new dedicated parsers.

Data-driven: each CASE pins a parser against a synthesized sample and asserts
the 6-tuple schema + presence/absence expectations (happy-path + adversarial).
Re-run after adding each parser so prior parsers act as regression checks.

Usage:  python tmp_verify/check.py
Delete the tmp_verify/ dir once all parsers are done.
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'src', 'parsers'))

CASES = []


def case(name, importer, fn_name, ext, src, *,
         want_imports=(), want_defs=(), want_syms=(),
         forbid_imports=(), forbid_defs=(), lang=None):
    """Register a verification case."""
    CASES.append(dict(
        name=name, importer=importer, fn_name=fn_name, ext=ext, src=src,
        want_imports=set(want_imports), want_defs=set(want_defs),
        want_syms=set(want_syms), forbid_imports=set(forbid_imports),
        forbid_defs=set(forbid_defs), lang=lang,
    ))


def _check_schema(name, t):
    assert isinstance(t, tuple) and len(t) == 6, f"{name}: not a 6-tuple"
    imports, funcdefs, funccalls, extra, fcbf, symbol_defs = t
    assert isinstance(imports, list), f"{name}: imports not list"
    assert isinstance(funcdefs, list), f"{name}: funcdefs not list"
    assert isinstance(funccalls, list), f"{name}: funccalls not list"
    assert isinstance(extra, dict), f"{name}: extra not dict"
    assert isinstance(fcbf, list), f"{name}: func_calls_by_func not list"
    assert len(fcbf) == len(funcdefs), \
        f"{name}: fcbf len {len(fcbf)} != funcdefs len {len(funcdefs)}"
    assert isinstance(symbol_defs, list), f"{name}: symbol_defs not list"
    for fd in funcdefs:
        assert set(('label', 'is_efiapi', 'is_static')) <= set(fd), \
            f"{name}: funcdef missing keys: {fd}"
    for s in symbol_defs:
        for k in ('kind', 'name', 'line', 'end_line', 'bases', 'parent',
                  'is_public', 'doc'):
            assert k in s, f"{name}: symbol missing '{k}': {s}"
        assert s['end_line'] >= s['line'], \
            f"{name}: end_line<line for {s['name']} ({s['line']}->{s['end_line']})"
    return t


def run():
    failures = 0
    for c in CASES:
        name = c['name']
        try:
            mod = __import__(c['importer'])
            fn = getattr(mod, c['fn_name'])
            try:
                t = fn(c['src'], c['ext'])
            except TypeError:
                t = fn(c['src'])
            imports, funcdefs, funccalls, extra, fcbf, symbol_defs = _check_schema(name, t)

            def_labels = {fd['label'] for fd in funcdefs}
            sym_names = {s['name'] for s in symbol_defs}
            imp_set = set(imports)

            miss_i = c['want_imports'] - imp_set
            miss_d = c['want_defs'] - def_labels
            miss_s = c['want_syms'] - sym_names
            bad_i = c['forbid_imports'] & imp_set
            bad_d = c['forbid_defs'] & (def_labels | sym_names)

            problems = []
            if miss_i: problems.append(f"missing imports {sorted(miss_i)}")
            if miss_d: problems.append(f"missing defs {sorted(miss_d)}")
            if miss_s: problems.append(f"missing syms {sorted(miss_s)}")
            if bad_i:  problems.append(f"FALSE imports {sorted(bad_i)}")
            if bad_d:  problems.append(f"FALSE defs {sorted(bad_d)}")
            if c['lang'] and extra.get('lang') != c['lang']:
                problems.append(f"lang={extra.get('lang')!r} != {c['lang']!r}")

            if problems:
                failures += 1
                print(f"FAIL {name}: " + "; ".join(problems))
                print(f"     imports={sorted(imp_set)}")
                print(f"     defs={sorted(def_labels)}")
                print(f"     syms={sorted(sym_names)}")
            else:
                print(f"ok   {name}  (imports={len(imports)} defs={len(funcdefs)} "
                      f"syms={len(symbol_defs)} lang={extra.get('lang')})")
        except Exception as e:
            failures += 1
            import traceback
            print(f"ERROR {name}: {e}")
            traceback.print_exc()

    print("-" * 60)
    print(f"{len(CASES)} cases, {failures} failing")
    return failures


# ─── CASES (appended per language) ───────────────────────────────────────────

case(
    "R", "r_parser", "scan_r", ".r",
    r'''
library(dplyr)
require("ggplot2")
source("helpers/util.R")

# this is a comment: library(should_not_import) and foo <- function() {}
msg <- "library(also_not) and bar <- function()"

add <- function(a, b) {
  if (a > b) {
    return(a)
  }
  process(a, b)
}

square = function(x) x * x

Account <- R6Class("Account", public = list(
  deposit = function(amount) { validate(amount) }
))

setClass("Vehicle", representation(wheels = "numeric"))
''',
    want_imports=("dplyr", "ggplot2", "util"),
    want_defs=("add", "square"),
    want_syms=("add", "square", "Account", "Vehicle"),
    forbid_imports=("should_not_import", "also_not"),
    forbid_defs=("foo", "bar"),
    lang="r",
)

case(
    "Protobuf", "protobuf_parser", "scan_protobuf", ".proto",
    r'''
syntax = "proto3";
package example.api;

import "common/types.proto";
import public "google/protobuf/timestamp.proto";

// import "should_not_count.proto"; commented out

message User {
  string name = 1;       // field, not a def
  int32 id = 2;
  message Address {
    string city = 1;
  }
}

enum Status {
  ACTIVE = 0;
  INACTIVE = 1;
}

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListRequest) returns (stream User) {
    option deadline = 30;
  }
}
''',
    want_imports=("types", "timestamp"),
    want_defs=("GetUser", "ListUsers"),
    want_syms=("User", "Address", "Status", "UserService", "GetUser"),
    forbid_imports=("should_not_count",),
    forbid_defs=("name", "string", "id"),
    lang="protobuf",
)

case(
    "GraphQL", "graphql_parser", "scan_graphql", ".graphql",
    r'''
#import "./fragments/userFields.graphql"
# import "should_not_count.graphql"

"""A user in the system."""
type User implements Node & Timestamped {
  id: ID!
  name: String
  posts(first: Int, after: String): [Post!]!
}

interface Node {
  id: ID!
}

input CreateUserInput {
  name: String!
}

enum Role {
  ADMIN
  MEMBER
}

union SearchResult = User | Post

scalar DateTime

type Query {
  user(id: ID!): User
  search(term: String): SearchResult
}
''',
    want_imports=("userFields",),
    want_defs=("posts", "user", "search"),
    want_syms=("User", "Node", "CreateUserInput", "Role", "SearchResult",
               "DateTime", "Query"),
    forbid_imports=("should_not_count",),
    forbid_defs=("id", "name"),
    lang="graphql",
)

case(
    "Zig", "zig_parser", "scan_zig", ".zig",
    r'''
const std = @import("std");
const helper = @import("utils/helper.zig");

// const fake = @import("should_not_count.zig");
const note =
    \\ this is a multiline string with @import("not_real.zig") and fn nope()
;

pub const Point = struct {
    x: i32,
    y: i32,

    pub fn add(self: Point, other: Point) Point {
        if (self.x > other.x) {
            return scale(self);
        }
        return self;
    }
};

const Color = enum { red, green, blue };

fn scale(p: Point) Point {
    return p;
}

extern fn c_func(x: i32) i32;
''',
    want_imports=("std", "helper"),
    want_defs=("add", "scale", "c_func"),
    want_syms=("Point", "Color", "add", "scale"),
    forbid_imports=("should_not_count", "not_real"),
    forbid_defs=("nope",),
    lang="zig",
)

case(
    "D", "d_parser", "scan_d", ".d",
    r'''
module myapp.core;

import std.stdio;
import std.algorithm : map, filter;
import mypkg.helper;

/+ nested /+ comment +/ import std.should_not_count; +/
// import std.also_not;
string note = "import std.string_literal; void fake() {}";

class Account : Base, ISerializable {
    private int balance;

    public int deposit(int amount) {
        if (amount > 0) {
            balance += compute(amount);
        }
        return balance;
    }
}

struct Point {
    int x, y;
}

void main() {
    auto a = new Account();
    process(a);
}
''',
    want_imports=("stdio", "algorithm", "helper"),
    want_defs=("deposit", "main"),
    want_syms=("Account", "Point", "deposit", "main"),
    forbid_imports=("should_not_count", "also_not", "string_literal"),
    forbid_defs=("fake",),
    lang="d",
)

case(
    "SQL", "sql_parser", "scan_sql", ".sql",
    r"""
\i schema/init.sql
.read seed_data.sql
-- \i should_not_count.sql
/* CREATE TABLE commented_out (id int); */

CREATE TABLE public.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    note TEXT DEFAULT 'CREATE TABLE not_a_table (x int);'
);

CREATE OR REPLACE VIEW active_users AS
    SELECT * FROM users WHERE active = true;

CREATE TYPE mood AS ENUM ('happy', 'sad');

CREATE OR REPLACE FUNCTION calc_total(uid int) RETURNS int AS $$
BEGIN
    IF uid > 0 THEN
        RETURN (SELECT count(*) FROM orders WHERE user_id = uid);
    END IF;
    RETURN 0;
END;
$$ LANGUAGE plpgsql;

CREATE PROCEDURE refresh_stats() LANGUAGE sql AS $$
    SELECT 1;
$$;
""",
    want_imports=("init", "seed_data"),
    want_defs=("calc_total", "refresh_stats"),
    want_syms=("users", "active_users", "mood", "calc_total", "refresh_stats"),
    forbid_imports=("should_not_count",),
    forbid_defs=("commented_out", "not_a_table"),
    lang="sql",
)

if __name__ == '__main__':
    sys.exit(1 if run() else 0)
