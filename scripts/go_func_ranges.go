//go:build ignore

// go_func_ranges prints address ranges recovered from a stripped Go binary's
// pclntab. It is a maintenance helper for locating AGY's render functions
// without modifying the binary.
package main

import (
	"bytes"
	"debug/gosym"
	"debug/macho"
	"fmt"
	"os"
	"strings"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintf(os.Stderr, "usage: go run %s <mach-o> <name-fragment>...\n", os.Args[0])
		os.Exit(2)
	}

	file, err := macho.Open(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "open Mach-O: %v\n", err)
		os.Exit(1)
	}
	defer file.Close()

	textSection := file.Section("__text")
	if textSection == nil {
		fmt.Fprintln(os.Stderr, "Mach-O is missing __text")
		os.Exit(1)
	}

	var pcln []byte
	if pclnSection := file.Section("__gopclntab"); pclnSection != nil {
		pcln, err = pclnSection.Data()
		if err != nil {
			fmt.Fprintf(os.Stderr, "read __gopclntab: %v\n", err)
			os.Exit(1)
		}
	} else {
		// Google's release linker stores the Go metadata in a combined
		// __lrodata_gopcln section. Locate the pclntab header by its versioned
		// magic instead of assuming a dedicated section name.
		combined := file.Section("__lrodata_gopcln")
		if combined == nil {
			fmt.Fprintln(os.Stderr, "Mach-O is missing Go pclntab metadata")
			os.Exit(1)
		}
		data, readErr := combined.Data()
		if readErr != nil {
			fmt.Fprintf(os.Stderr, "read __lrodata_gopcln: %v\n", readErr)
			os.Exit(1)
		}
		for _, magic := range [][]byte{
			{0xf1, 0xff, 0xff, 0xff, 0x00, 0x00, 0x04, 0x08}, // Go 1.20+ arm64
			{0xf0, 0xff, 0xff, 0xff, 0x00, 0x00, 0x04, 0x08}, // Go 1.18 arm64
			{0xfa, 0xff, 0xff, 0xff, 0x00, 0x00, 0x04, 0x08}, // Go 1.16 arm64
		} {
			if offset := bytes.Index(data, magic); offset >= 0 {
				pcln = data[offset:]
				break
			}
		}
		if pcln == nil {
			fmt.Fprintln(os.Stderr, "could not locate a supported pclntab header")
			os.Exit(1)
		}
	}

	lineTable := gosym.NewLineTable(pcln, textSection.Addr)
	table, err := gosym.NewTable(nil, lineTable)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse Go symbol table: %v\n", err)
		os.Exit(1)
	}

	matches := 0
	for _, function := range table.Funcs {
		for _, fragment := range os.Args[2:] {
			if strings.Contains(function.Name, fragment) {
				fmt.Printf("0x%x 0x%x %s\n", function.Entry, function.End, function.Name)
				matches++
				break
			}
		}
	}
	if matches == 0 {
		os.Exit(3)
	}
}
