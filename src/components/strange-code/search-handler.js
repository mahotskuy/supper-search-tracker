import $ from "jquery";
import * as React from 'react';

$(".super-navbar__button.super-navbar__search").one("click", () => {
    setTimeout(function () {
        var typingTimer;                //timer identifier
        var doneTypingInterval = 1000;  //time in ms, 5 seconds for example
        var $input = $('.notion-search__input input');

        //on keyup, start the countdown
        $input.on('keyup', function () {
            clearTimeout(typingTimer);
            typingTimer = setTimeout(doneTyping, doneTypingInterval);
        });

        //on keydown, clear the countdown 
        $input.on('keydown', function () {
            clearTimeout(typingTimer);
        });

        //user is "finished typing," do something
        function doneTyping() {
            $.ajax({
                type: "POST",
                url: "https://main--preeminent-donut-6cb31b.netlify.app/.netlify/functions/api/super-search",
                data: {
                    "text": $input.val(),
                    "spreadsheetId": "12wvKsgu8C3RKWIky2eD-RN7s21gxcaZUHceL3QTtrEI"
                },
                dataType: "json"
            });
        }
    }, 100);
});

export function DisableLint() {
       return (
        <span />
    );
}
